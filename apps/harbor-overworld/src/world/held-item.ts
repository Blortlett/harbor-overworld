// What the local player is holding, set from outside the game (Blort's
// inventory) so the game never imports it. Today that is only the gun: when
// armed, the player can draw and fire it without the crown.

let armed = false;

export function isArmed() {
  return armed;
}

export function setArmed(next: boolean) {
  armed = next;
}
