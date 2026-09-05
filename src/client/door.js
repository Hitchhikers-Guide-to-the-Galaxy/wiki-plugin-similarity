// wiki-plugin-similarity — the search box door, a preference of this browser
//
// The wiki's footer search box is the wiki's own unless the reader opens the
// door: a checkbox on the Search Tool page (the DOOR item) that sends what is
// typed there to the Search Tool instead. Off by default, remembered under
// one localStorage key beside the plugin's other keys, read at the moment
// Enter is pressed so a change takes effect without a reload. Storage is a
// parameter so the rules can be tested without a browser.

const DOOR_KEY = 'similarity:door'

const storage = () => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

const doorOpen = (s = storage()) => {
  try { return !!s && s.getItem(DOOR_KEY) === 'on' } catch { return false }
}

const setDoor = (on, s = storage()) => {
  try {
    if (!s) return false
    if (on) s.setItem(DOOR_KEY, 'on')
    else s.removeItem(DOOR_KEY)
    return true
  } catch { return false }
}

export { DOOR_KEY, doorOpen, setDoor }
