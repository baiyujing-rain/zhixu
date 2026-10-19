/** A fresh document owns its own cache; a reloaded tab remembers the previous document. */
let identity: { current: string; previous: string | null } | null = null;
export function draftOwner() {
  if (typeof window === 'undefined') return { current: 'server', previous: null };
  if (!identity) {
    let previous: string | null = null;
    try { previous = sessionStorage.getItem('zhixu-draft-owner'); } catch {}
    const current = crypto.randomUUID();
    identity = { current, previous };
    try { sessionStorage.setItem('zhixu-draft-owner', current); } catch {}
  }
  return identity;
}
export function ownedDraftKey(base: string) { return `${base}:${draftOwner().current}`; }
export function previousDraftKey(base: string) { const previous = draftOwner().previous; return previous ? `${base}:${previous}` : null; }
