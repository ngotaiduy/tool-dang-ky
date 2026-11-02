/*
 * Runs inside the Facebook post tab (chrome.scripting.executeScript).
 * Must stay self-contained: it is serialised with Function.prototype.toString().
 * Only the main post's message is read, so links in comments or suggested posts are ignored.
 * A post can list one link per exam level, so `labels` pick the link on the same line.
 */
function collectFormLinks(labels) {
  const FORM_LINK = /(?:https?:\/\/)?(?:forms\.gle\/[A-Za-z0-9]+|docs\.google\.com\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+(?:\/viewform)?)/g;
  const post = document.querySelector('[data-ad-rendering-role=story_message], [data-ad-comet-preview=message], [data-ad-preview=message]')
    || document.querySelector('[role=article]');
  if (!post) return { ready: false, all: [], labelled: [] };

  const seeMore = [...post.querySelectorAll('[role=button]')].find(b => /^(xem thêm|see more)$/i.test(b.innerText.trim()));
  if (seeMore) seeMore.click();
  const ready = !seeMore;

  const decode = s => s.replace(/%3A/gi, ':').replace(/%2F/gi, '/').normalize('NFKC');
  const linksIn = line => (decode(line).match(FORM_LINK) || []).map(link => (link.startsWith('http') ? link : 'https://' + link));
  const compact = s => s.normalize('NFKC').replace(/\s+/g, '').toUpperCase();

  // Facebook shortens long link text with "…"; the anchor href keeps the full URL.
  const hrefLinks = [...post.querySelectorAll('a[href]')].flatMap(a => linksIn(a.href));
  const full = link => hrefLinks.find(href => href.startsWith(link)) || link;

  const lines = decode(post.innerText).split('\n');
  const all = [...new Set([...lines.flatMap(linksIn).map(full), ...hrefLinks])];

  const keys = (labels || []).map(compact).filter(Boolean);
  const isLinkOnly = line => !!line && line.replace(FORM_LINK, '').replace(/[\s…]/g, '') === '';
  const labelled = [];
  lines.forEach((line, i) => {
    if (!keys.some(key => compact(line).includes(key))) return;
    const own = linksIn(line);
    if (own.length) labelled.push(...own);
    else if (isLinkOnly(lines[i + 1])) labelled.push(...linksIn(lines[i + 1]));
  });
  return { ready, all, labelled: [...new Set(labelled.map(full))] };
}
