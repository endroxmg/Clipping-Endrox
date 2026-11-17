class StudioHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <a class="studio-brand" aria-label="Endrox Studio" href="/app">
        <img width="25" height="25" alt=""><strong>endrox</strong><span>Studio</span>
      </a>
      <nav aria-label="Workspace">
        <a href="/app/media" data-section="media">Your clips</a>
        <a href="/app/editor" data-section="editor">Editor</a>
        <a href="/app/operations" data-section="operations">Live &amp; publishing</a>
        <a href="/app/settings/ai" data-section="settings">Settings</a>
      </nav>
      <a class="studio-import" id="import" href="/app/media?import=1"><span aria-hidden="true">+</span> Import footage</a>`;
    this.querySelector('img').src = document.querySelector('link[rel="icon"]').href;
    if (this.hasAttribute('launcher')) {
      this.querySelector('.studio-brand').href = '/';
      for (const link of this.querySelectorAll('nav a, .studio-import')) {
        link.addEventListener('click', event => {
          event.preventDefault();
          history.pushState(null, '', link.getAttribute('href'));
          dispatchEvent(new PopStateEvent('popstate'));
        });
      }
    }
    this.selectPath(location.pathname);
  }

  selectPath(path) {
    const [, root, section] = path.split('/');
    let current = '';
    if (root === 'app') {
      if (!section || section === 'editor') current = 'editor';
      else if (section === 'settings' || section === 'media') current = section;
      else current = 'operations';
    }
    for (const link of this.querySelectorAll('[data-section]')) {
      if (link.dataset.section === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
}
customElements.define('studio-header', StudioHeader);
