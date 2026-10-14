'use strict';

const vscode = require('vscode');

const STORE_KEY = 'vscodeFtp.connections';
const SECRET_PREFIX = 'vscodeFtp.password.';

/**
 * Baglanti tanimlarini tutar.
 *
 * Sifreler bilerek ayri yerde: tanimlar workspaceState'te (duz JSON) duruyor ama
 * parolalar vscode.SecretStorage'a yaziliyor, yani isletim sisteminin anahtar
 * zincirine. settings.json'a sifre yazan eklentiler bunu yanlis yapiyor; o dosya
 * yanlislikla commit'lenebilir veya paylasilabilir.
 *
 * Bir baglanti iki kapsamdan birinde yasar:
 *   "workspace" -> yalnizca bu projede gorunur (workspaceState)
 *   "global"    -> butun pencerelerde gorunur (globalState)
 */
class ConnectionStore {
  /**
   * @param {vscode.ExtensionContext} context
   * @param {import('./logger').Logger} logger
   */
  constructor(context, logger) {
    this.context = context;
    this.logger = logger;
    this.onDidChangeEmitter = new vscode.EventEmitter();
    this.onDidChange = this.onDidChangeEmitter.event;
  }

  /** Iki kapsami birlestirip dondurur. Ayni id iki yerdeyse workspace kazanir. */
  list() {
    const global = this.context.globalState.get(STORE_KEY, []);
    const workspace = this.context.workspaceState.get(STORE_KEY, []);
    const merged = new Map();
    for (const connection of global) merged.set(connection.id, connection);
    for (const connection of workspace) merged.set(connection.id, connection);
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }

  find(id) {
    return this.list().find((connection) => connection.id === id);
  }

  /** Sifre haric tanimi dondurur — log ve UI icin guvenli olan bu. */
  static publicView(connection) {
    if (!connection) return null;
    const { id, name, protocol, host, port, user, remoteRoot, localRoot, scope } = connection;
    return { id, name, protocol, host, port, user, remoteRoot, localRoot, scope };
  }

  _stateFor(scope) {
    return scope === 'global' ? this.context.globalState : this.context.workspaceState;
  }

  async save(connection, password) {
    const record = {
      id: connection.id || ConnectionStore.newId(),
      name: connection.name,
      protocol: connection.protocol === 'sftp' ? 'sftp' : 'ftp',
      host: connection.host,
      port: Number(connection.port) || (connection.protocol === 'sftp' ? 22 : 21),
      user: connection.user || '',
      remoteRoot: connection.remoteRoot || '/',
      localRoot: connection.localRoot || '',
      scope: connection.scope === 'global' ? 'global' : 'workspace',
      secure: connection.protocol === 'sftp' ? true : Boolean(connection.secure),
    };

    const state = this._stateFor(record.scope);
    const existing = state.get(STORE_KEY, []);
    const index = existing.findIndex((item) => item.id === record.id);
    if (index === -1) existing.push(record);
    else existing[index] = record;
    await state.update(STORE_KEY, existing);

    if (typeof password === 'string' && password.length > 0) {
      await this.context.secrets.store(SECRET_PREFIX + record.id, password);
    }

    this.logger.info(`Baglanti kaydedildi: ${record.name} (${record.protocol}://${record.host}:${record.port})`);
    this.onDidChangeEmitter.fire();
    return record;
  }

  async getPassword(id) {
    return this.context.secrets.get(SECRET_PREFIX + id);
  }

  async remove(id) {
    for (const state of [this.context.workspaceState, this.context.globalState]) {
      const existing = state.get(STORE_KEY, []);
      const remaining = existing.filter((item) => item.id !== id);
      if (remaining.length !== existing.length) await state.update(STORE_KEY, remaining);
    }
    await this.context.secrets.delete(SECRET_PREFIX + id);
    this.logger.info(`Baglanti silindi: ${id}`);
    this.onDidChangeEmitter.fire();
  }

  static newId() {
    return `conn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

module.exports = { ConnectionStore, STORE_KEY, SECRET_PREFIX };
