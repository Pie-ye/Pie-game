let mountedRoot = null;

export function mount(root, _sdk) {
  mountedRoot = root;
  root.innerHTML = '<section class="placeholder-panel"><p class="placeholder-msg">搬家中，即將開放</p></section>';
}

export function unmount() {
  if (mountedRoot) {
    mountedRoot.innerHTML = '';
    mountedRoot = null;
  }
}
