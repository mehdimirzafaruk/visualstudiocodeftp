'use strict';

const path = require('path');

/**
 * Uzak yollari tek bir bicime indirger: bolu isaretleri "/", sonda egik cizgi yok.
 * Kok dizin her zaman "/" olarak kalir.
 *
 * FTP sunuculari Windows'tan gelen "\" ayracini cogu zaman anlamaz, kullanicilar da
 * elle "public_html/sub/" gibi degerler yazar. Ikisini de burada duzeltiyoruz ki
 * ust katmanlar yol birlestirmeyle ugrasmasin.
 */
function normalizeRemote(value) {
  if (value === undefined || value === null) return '/';
  const withSlashes = String(value).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (withSlashes === '' || withSlashes === '/') return '/';
  const stripped = withSlashes.replace(/\/+$/, '');
  if (stripped === '') return '/';
  return stripped.startsWith('/') ? stripped : '/' + stripped;
}

/** normalizeRemote'in tersi degil: uzak yolu base'in altina ekler. */
function joinRemote(base, relative) {
  const root = normalizeRemote(base);
  const rel = String(relative).split(path.sep).join('/').replace(/^\/+/, '');
  if (rel === '') return root;
  if (root === '/') return '/' + rel;
  return root + '/' + rel;
}

/**
 * Yerel dosya yolunu, baglanti eslemesine gore uzak yola cevirir.
 *
 * Donus: uzak yol, ya da null (dosya localRoot'un disinda kaliyorsa). null donmesi
 * onemli: kullanicinin workspace disindaki bir dosyayi kazara sunucuya yazmasini
 * engelleyen tek kontrol bu.
 */
function toRemotePath(localPath, mapping) {
  const localRoot = path.resolve(mapping.localRoot);
  const resolved = path.resolve(localPath);
  const relative = path.relative(localRoot, resolved);

  if (relative === '') return normalizeRemote(mapping.remoteRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

  return joinRemote(mapping.remoteRoot, relative);
}

/**
 * Uzak yolu yerel yola cevirir. Yine sinir kontrolu var: hedef, localRoot'un
 * disina cikan bir yol uretiyorsa null doner.
 */
function toLocalPath(remotePath, mapping) {
  const remoteRoot = normalizeRemote(mapping.remoteRoot);
  const target = normalizeRemote(remotePath);

  if (target === remoteRoot) return path.resolve(mapping.localRoot);
  if (remoteRoot !== '/' && !target.startsWith(remoteRoot + '/')) return null;

  const relative = remoteRoot === '/' ? target.slice(1) : target.slice(remoteRoot.length + 1);
  const resolved = path.resolve(mapping.localRoot, relative);

  const localRoot = path.resolve(mapping.localRoot);
  if (resolved !== localRoot && !resolved.startsWith(localRoot + path.sep)) return null;

  return resolved;
}

/**
 * Kaydetme aninda yuklemede atlanacak yollar. Kullanicinin ayarindaki her parcayi
 * yol icinde arar; ".git" hem "/proje/.git/x" hem de "a.gitignore"? hayir —
 * parca siniri kontrol edilir, "git" yazinca "gitti.txt" atlanmaz.
 */
function isExcluded(localPath, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const segments = localPath.split(path.sep).filter(Boolean);
  return patterns.some((pattern) => {
    const clean = String(pattern).replace(/^\/+|\/+$/g, '');
    if (clean === '') return false;
    return segments.includes(clean);
  });
}

module.exports = {
  normalizeRemote,
  joinRemote,
  toRemotePath,
  toLocalPath,
  isExcluded,
};
