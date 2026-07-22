// wiki-plugin-similarity — query embedder, child-process supervisor (CommonJS)
//
// Since 0.9.0 the wiki-server process NEVER touches onnx/transformers: all
// inference runs in a fork()ed embed-child.js whose crash is an event here,
// not a farm outage. (0.8.x ran the WASM runtime in-process; a fatal error
// there took down every site the farm served — see the 2026-07-22
// hitchhikers.earth incident.) This module supervises the child:
//
//   - lazy fork on first use, V8 heap capped via --max-old-space-size
//     (WIKI_EMBED_CHILD_HEAP_MB, default 512)
//   - per-request timeout (WIKI_EMBED_TIMEOUT_MS, default 60s — first call
//     includes model load; the one-time ~130MB download can exceed this,
//     in which case warm() retries make it eventually succeed)
//   - circuit breaker: WIKI_EMBED_MAX_CRASHES abnormal exits (default 3)
//     within WIKI_EMBED_CRASH_WINDOW_MS (default 10 min) opens the breaker
//     for WIKI_EMBED_COOLDOWN_MS (default 5 min); while open, embed()
//     rejects immediately with err.code = 'EMBEDDER_DOWN' so routes can
//     answer 503 instead of respawning a crash-loop
//   - the child's clean idle self-exit (code 0) is not a crash
//
// Embedding parity knobs (WIKI_EMBED_MODEL / _POOLING / _QUANTIZED) are read
// by the child from the inherited env — see embed-child.js for why they
// exist and their defaults (bge-small-en-v1.5, cls, fp32 — must match the
// prebuilt semantic-vectors.json).
//
// wiki-plugin-semindex's shared worker-thread embedder is still preferred
// when installed: one model instance per process, shared with bulk indexing.
// The sibling path works for npm installs (wiki/node_modules/*) and dev
// symlinks (~/Code/wiki-plugins/*) alike; the bare require covers other
// layouts.

const path = require('node:path')
const fs   = require('node:fs')
const { fork } = require('node:child_process')

// WIKI_EMBED_NO_SEMINDEX=1 forces the child-process path even when semindex
// is installed — for tests, and for opting a farm out of delegation.
const semindexLib = (() => {
  if (process.env.WIKI_EMBED_NO_SEMINDEX === '1') return null
  try {
    const sibling = path.resolve(__dirname, '../../wiki-plugin-semindex/server/embed-lib.js')
    if (fs.existsSync(sibling)) return require(sibling)
    return require('wiki-plugin-semindex/server/embed-lib.js')
  } catch { return null }
})()

const HEAP_MB         = parseInt(process.env.WIKI_EMBED_CHILD_HEAP_MB) || 512
const TIMEOUT_MS      = parseInt(process.env.WIKI_EMBED_TIMEOUT_MS) || 60_000
const MAX_CRASHES     = parseInt(process.env.WIKI_EMBED_MAX_CRASHES) || 3
const CRASH_WINDOW_MS = parseInt(process.env.WIKI_EMBED_CRASH_WINDOW_MS) || 10 * 60_000
const COOLDOWN_MS     = parseInt(process.env.WIKI_EMBED_COOLDOWN_MS) || 5 * 60_000

const embedderError = (message, code) => {
  const e = new Error(message)
  if (code) e.code = code
  return e
}

let child = null
let nextId = 1
const inflight = new Map() // id → {resolve, reject, timer}

let crashTimes = []
let breakerOpenUntil = 0
let lastError = null

const breakerOpen = () => Date.now() < breakerOpenUntil

const ensureChild = () => {
  if (child) return child
  child = fork(path.join(__dirname, 'embed-child.js'), [], {
    execArgv: [`--max-old-space-size=${HEAP_MB}`],
  })
  child.on('message', msg => {
    const pending = inflight.get(msg.id)
    if (!pending) return
    inflight.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.ok) pending.resolve(msg)
    else pending.reject(embedderError(msg.error))
  })
  child.on('error', e => { lastError = `fork failed: ${e.message}` })
  child.on('exit', (code, signal) => {
    child = null
    const abnormal = code !== 0
    const why = signal ? `signal ${signal}` : `code ${code}`
    for (const pending of inflight.values()) {
      clearTimeout(pending.timer)
      pending.reject(embedderError(`embedder process exited (${why})`))
    }
    inflight.clear()
    if (!abnormal) return
    lastError = `embed child exited: ${why}`
    console.error(`[wiki-plugin-similarity] ${lastError}`)
    const now = Date.now()
    crashTimes = crashTimes.filter(t => now - t < CRASH_WINDOW_MS)
    crashTimes.push(now)
    if (crashTimes.length >= MAX_CRASHES) {
      breakerOpenUntil = now + COOLDOWN_MS
      console.error(`[wiki-plugin-similarity] ${crashTimes.length} embedder crashes in ` +
        `${Math.round(CRASH_WINDOW_MS / 60_000)} min — semantic search disabled for ` +
        `${Math.round(COOLDOWN_MS / 60_000)} min`)
    }
  })
  return child
}

const request = (op, text) => {
  if (breakerOpen()) {
    return Promise.reject(embedderError(
      'semantic search temporarily unavailable (embedder crashed repeatedly, cooling down)',
      'EMBEDDER_DOWN'))
  }
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      inflight.delete(id)
      reject(embedderError(`embed timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)
    inflight.set(id, { resolve, reject, timer })
    try {
      ensureChild().send({ id, op, text })
    } catch (e) {
      inflight.delete(id)
      clearTimeout(timer)
      reject(embedderError(`embedder unavailable: ${e.message}`))
    }
  })
}

// Embed one text → plain number[384], unit-normalised.
const embed = async text => {
  if (semindexLib) return semindexLib.embed(text)
  const { vector } = await request('embed', text)
  return vector
}

// Warm the model in the background (call at startup; failures just log —
// they can no longer crash the server). With semindex delegation, don't
// warm — its worker spawns on demand and self-terminates when idle;
// pre-warming would just pin ~0.5GB.
const warm = () => {
  if (semindexLib) return
  request('warm').catch(e =>
    console.error('[wiki-plugin-similarity] embedder warm failed:', e.message))
}

// Supervisor state for /system/similarity-health.json.
const status = () => {
  if (semindexLib) return { via: 'semindex' }
  return {
    via: 'child-process',
    state: breakerOpen() ? 'down' : child ? 'running' : 'idle',
    recentCrashes: crashTimes.filter(t => Date.now() - t < CRASH_WINDOW_MS).length,
    breakerOpenUntil: breakerOpen() ? new Date(breakerOpenUntil).toISOString() : null,
    lastError,
  }
}

module.exports = { embed, warm, status, viaSemindex: !!semindexLib }
