// Sign-in screen: one clear button, plain-language messages for cancelled/expired sign-ins.
import { html } from '../lib.js';
import { Icon } from '../icons.js';
import { app, useStore } from '../store.js';
import * as G from '../github.js';
import config from '../../config.js';

const MESSAGES = {
  access_denied: { tone: 'info', text: 'You cancelled the GitHub sign-in. Press the button to try again.' },
  expired: { tone: 'warn', text: 'Your sign-in expired. Please sign in again.' },
  signedout: { tone: 'info', text: 'You have signed out.' },
  github_unavailable: { tone: 'warn', text: "GitHub didn't answer. Wait a minute and try again." },
};

export function SignInView() {
  const err = useStore(app, (s) => s.authError);
  const notConfigured = !G.endpoints.mock && /example\.workers\.dev/.test(G.endpoints.worker || '');
  const msg = err ? MESSAGES[err] || { tone: 'warn', text: `Sign-in didn't work (${err}). Please try again; if it keeps happening, tell the person who set up Design Hub.` } : null;
  return html`<div class="gate"><div class="gate-card signin-card">
    <div class="gate-brand"><img src="favicon.svg" alt="" width="32" height="32" /><span>${config.appName || 'Design Hub'}</span></div>
    <h1 class="gate-title">Sign in to see your game's design</h1>
    <p class="gate-text">Design Hub shows the design docs, balance numbers and art reviews that live in your game's GitHub repo. Sign in with your GitHub account — you'll see the projects you've been invited to.</p>
    ${msg && html`<div class=${'signin-msg signin-msg-' + msg.tone} role="status">${msg.text}</div>`}
    ${notConfigured ? html`<div class="signin-msg signin-msg-warn" role="alert">This copy of Design Hub isn't connected to its sign-in service yet. The person who set it up needs to put the Worker URL in <code>config.js</code> (see the hosting guide).</div>`
      : html`<a class="btn btn-primary btn-lg btn-block signin-btn" href=${G.signInUrl()} onClick=${(e) => { e.preventDefault(); app.set({ authError: null }); G.signIn(); }}>
          <${Icon} name="github" size=${18} />Sign in with GitHub</a>`}
    <p class="gate-foot muted">No GitHub account yet? Create one at github.com, then ask the project owner to add you as a collaborator on the game's repo.</p>
    ${G.endpoints.mock && html`<p class="gate-foot"><span class="badge badge-accent">Mock</span> Local test mode — signing in picks a pretend user.</p>`}
  </div></div>`;
}
