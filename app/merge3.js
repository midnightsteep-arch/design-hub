// Three-way line merge for pages (contract §8). Pure module.
// merge3(base, mine, theirs) → {clean:boolean, text, conflicts:[{base, mine, theirs}], chunks}
// chunks: [{type:'ok', lines}] | [{type:'conflict', base, mine, theirs}] so a UI can let the user pick per conflict.

function splitLines(s) {
  const t = String(s == null ? '' : s).replace(/\r\n/g, '\n');
  if (t === '') return [];
  const parts = t.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// Longest common subsequence matches between a and b → array of [i, j] pairs (increasing).
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  // trim common prefix/suffix for speed
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const A = a.slice(pre, n - suf), B = b.slice(pre, m - suf);
  const N = A.length, M = B.length;
  const pairs = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  if (N && M) {
    const dp = Array.from({ length: N + 1 }, () => new Uint32Array(M + 1));
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < N && j < M) {
      if (A[i] === B[j]) { pairs.push([pre + i, pre + j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < suf; k++) pairs.push([n - suf + k, m - suf + k]);
  return pairs;
}

export function merge3(baseText, mineText, theirsText) {
  const O = splitLines(baseText), A = splitLines(mineText), B = splitLines(theirsText);
  const ma = new Map(lcsPairs(O, A).map(([o, a]) => [o, a]));
  const mb = new Map(lcsPairs(O, B).map(([o, b]) => [o, b]));
  const chunks = [];
  const push = (type, x) => {
    if (type === 'ok') {
      if (!x.length) return;
      const last = chunks[chunks.length - 1];
      if (last && last.type === 'ok') last.lines.push(...x); else chunks.push({ type: 'ok', lines: [...x] });
    } else chunks.push({ type: 'conflict', ...x });
  };
  let io = 0, ia = 0, ib = 0;
  for (;;) {
    // find next base line that is stable (matched in both, in order)
    let o = io;
    while (o < O.length && !(ma.has(o) && mb.has(o) && ma.get(o) >= ia && mb.get(o) >= ib)) o++;
    const ea = o < O.length ? ma.get(o) : A.length;
    const eb = o < O.length ? mb.get(o) : B.length;
    const oSeg = O.slice(io, o), aSeg = A.slice(ia, ea), bSeg = B.slice(ib, eb);
    if (oSeg.length || aSeg.length || bSeg.length) {
      const same = (x, y) => x.length === y.length && x.every((l, k) => l === y[k]);
      if (same(aSeg, bSeg)) push('ok', aSeg);
      else if (same(oSeg, aSeg)) push('ok', bSeg);
      else if (same(oSeg, bSeg)) push('ok', aSeg);
      else push('conflict', { base: oSeg, mine: aSeg, theirs: bSeg });
    }
    if (o >= O.length) break;
    push('ok', [O[o]]);
    io = o + 1; ia = ea + 1; ib = eb + 1;
  }
  const conflicts = chunks.filter((c) => c.type === 'conflict');
  return { clean: conflicts.length === 0, conflicts, chunks, text: conflicts.length ? null : joinChunks(chunks) };
}

/** Join chunks into text; `pick(conflict, index)` returns the lines to use for each conflict (default: both, mine first). */
export function joinChunks(chunks, pick) {
  const out = [];
  let ci = 0;
  for (const c of chunks) {
    if (c.type === 'ok') out.push(...c.lines);
    else out.push(...(pick ? pick(c, ci++) : [...c.mine, ...c.theirs]));
  }
  return out.length ? out.join('\n') + '\n' : '';
}

/** Text with git-style conflict markers, for a manual-edit fallback. */
export function withMarkers(chunks) {
  return joinChunks(chunks, (c) => ['<<<<<<< your version', ...c.mine, '=======', ...c.theirs, '>>>>>>> their version']);
}
