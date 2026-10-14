'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  normalizeRemote,
  joinRemote,
  toRemotePath,
  toLocalPath,
  isExcluded,
} = require('../src/path-map');

const ROOT = path.resolve('/proj');

test('uzak yolu tek bicime indirger', () => {
  assert.equal(normalizeRemote('/var/www/'), '/var/www');
  assert.equal(normalizeRemote('/var//www///sub/'), '/var/www/sub');
  assert.equal(normalizeRemote('var/www'), '/var/www');
  assert.equal(normalizeRemote(''), '/');
  assert.equal(normalizeRemote('/'), '/');
  assert.equal(normalizeRemote(undefined), '/');
  assert.equal(normalizeRemote(null), '/');
});

test('Windows ayracini da kabul eder', () => {
  assert.equal(normalizeRemote('\\public_html\\alt'), '/public_html/alt');
  assert.equal(normalizeRemote('public_html\\alt\\'), '/public_html/alt');
});

test('uzak yollari birlestirir, kok dizini bozmaz', () => {
  assert.equal(joinRemote('/', 'src'), '/src');
  assert.equal(joinRemote('/var/www', 'src'), '/var/www/src');
  assert.equal(joinRemote('/var/www/', '/src/app.js'), '/var/www/src/app.js');
  assert.equal(joinRemote('/var/www', ''), '/var/www');
});

test('yerel yolu uzak yola cevirir', () => {
  const mapping = { localRoot: ROOT, remoteRoot: '/var/www' };
  assert.equal(toRemotePath(path.join(ROOT, 'src', 'app.js'), mapping), '/var/www/src/app.js');
  assert.equal(toRemotePath(path.join(ROOT, 'app.js'), mapping), '/var/www/app.js');
});

test('yerel kokun kendisi uzak koke karsilik gelir', () => {
  const mapping = { localRoot: ROOT, remoteRoot: '/var/www' };
  assert.equal(toRemotePath(ROOT, mapping), '/var/www');
});

test('yerel kokun disindaki dosya reddedilir', () => {
  const mapping = { localRoot: ROOT, remoteRoot: '/var/www' };
  assert.equal(toRemotePath(path.resolve('/baska/yer/app.js'), mapping), null);
  assert.equal(toRemotePath(path.join(ROOT, '..', 'kacak.js'), mapping), null);
});

test('uzak yolu yerel yola cevirir', () => {
  const mapping = { localRoot: ROOT, remoteRoot: '/var/www' };
  assert.equal(toLocalPath('/var/www/src/app.js', mapping), path.join(ROOT, 'src', 'app.js'));
  assert.equal(toLocalPath('/var/www', mapping), ROOT);
});

test('uzak koke uymayan yol reddedilir', () => {
  const mapping = { localRoot: ROOT, remoteRoot: '/var/www' };
  assert.equal(toLocalPath('/etc/passwd', mapping), null);
  assert.equal(toLocalPath('/var/wwwx/app.js', mapping), null);
});

test('uzak yoldaki ust dizin kacisi yerel kokun disina cikamaz', () => {
  const mapping = { localRoot: ROOT, remoteRoot: '/var/www' };
  assert.equal(toLocalPath('/var/www/../../etc/passwd', mapping), null);
  assert.equal(toLocalPath('/var/www/../gizli.txt', mapping), null);
  // Kok icinde kalan ".." ise normal sekilde cozulur, engellenmesi gerekmez.
  assert.equal(toLocalPath('/var/www/src/../app.js', mapping), path.join(ROOT, 'app.js'));
});

test('haric listesi yol parcasi sinirina saygi duyar', () => {
  assert.equal(isExcluded(path.join(ROOT, 'node_modules', 'pkg', 'index.js'), ['node_modules']), true);
  assert.equal(isExcluded(path.join(ROOT, '.git', 'config'), ['.git']), true);
  assert.equal(isExcluded(path.join(ROOT, 'src', 'app.js'), ['node_modules']), false);
  // "git" parcasi ile "gitti.txt" dosyasi karismamali.
  assert.equal(isExcluded(path.join(ROOT, 'gitti.txt'), ['git']), false);
});

test('bos haric listesi hicbir seyi atlamaz', () => {
  assert.equal(isExcluded(path.join(ROOT, 'node_modules', 'x.js'), []), false);
  assert.equal(isExcluded(path.join(ROOT, 'node_modules', 'x.js'), undefined), false);
});
