'use strict';

const vscode = require('vscode');
const path = require('path');
const { createClient } = require('./create-client');
const { toRemotePath, toLocalPath, isExcluded, normalizeRemote } = require('./path-map');

/**
 * Aktif baglantiyi ve dosya transferlerini yonetir.
 *
 * Onemli kisit: FTP tek bir kontrol baglantisi uzerinden calisir; ayni anda iki
 * komut gonderirsen yanitlar birbirine karisir. Bu yuzden butun ag islemleri
 * _serial() kuyrugundan geciyor — kaydetme aninda yukleme acikken elle baska bir
 * yukleme tetiklenirse siraya girer, birbirini bozmaz.
 */
class SyncManager {
  /**
   * @param {import('./connection-store').ConnectionStore} store
   * @param {import('./logger').Logger} logger
   * @param {() => void} onStateChange
   */
  constructor(store, logger, onStateChange) {
    this.store = store;
    this.logger = logger;
    this.onStateChange = onStateChange || (() => {});

    this.activeId = null;
    this.client = null;

    // Kuyruk: her islem bir oncekinin bitmesini bekler.
    this._tail = Promise.resolve();
  }

  _serial(task) {
    const result = this._tail.then(task, task);
    // Kuyrugu yalnizca hata durumunda kopmamasi icin yutuyoruz; asil sonucu
    // cagirana donuyoruz.
    this._tail = result.then(() => undefined, () => undefined);
    return result;
  }

  get activeConnection() {
    return this.activeId ? this.store.find(this.activeId) : null;
  }

  isConnected() {
    return Boolean(this.client);
  }

  async connect(connectionId) {
    const connection = this.store.find(connectionId);
    if (!connection) throw new Error(`Bağlantı bulunamadı: ${connectionId}`);

    await this.disconnect();

    const password = await this.store.getPassword(connection.id);
    const timeout = vscode.workspace.getConfiguration('vscodeFtp').get('connectionTimeout', 15000);

    const client = createClient(connection, password, { timeout }, this.logger);
    await client.connect();

    this.client = client;
    this.activeId = connection.id;
    this.logger.info(`Aktif bağlantı: ${connection.name}`);
    this.onStateChange();
    return connection;
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        this.logger.exception('Bağlantı kapatılırken hata', error);
      }
    }
    this.client = null;
    this.activeId = null;
    this.onStateChange();
  }

  _requireClient() {
    if (!this.client) {
      throw new Error('Önce bir sunucuya bağlanın (FTP: Bağlan).');
    }
    return this.client;
  }

  /**
   * Baglanti tanimindan yerel/uzak kok eslemesini uretir.
   * localRoot bos birakildiysa acik olan workspace klasoru kullanilir.
   */
  mappingFor(connection) {
    const folders = vscode.workspace.workspaceFolders;
    const localRoot = connection.localRoot
      ? connection.localRoot
      : folders && folders.length > 0
        ? folders[0].uri.fsPath
        : '';

    if (!localRoot) {
      throw new Error('Yerel kök belirlenemedi. Bağlantıya bir yerel klasör tanımlayın.');
    }

    return {
      localRoot,
      remoteRoot: normalizeRemote(connection.remoteRoot),
    };
  }

  listRemote(remotePath) {
    return this._serial(() => this._requireClient().list(remotePath));
  }

  /**
   * Yerel bir dosyayi, aktif baglantinin eslemesine gore uzak sunucuya yazar.
   * @returns {Promise<string>} yazilan uzak yol
   */
  async uploadFile(localPath) {
    const connection = this.activeConnection;
    if (!connection) throw new Error('Önce bir sunucuya bağlanın.');

    const mapping = this.mappingFor(connection);
    const remotePath = toRemotePath(localPath, mapping);
    if (!remotePath) {
      throw new Error(
        `Dosya yerel kökün dışında, yüklenmedi: ${localPath}\nYerel kök: ${mapping.localRoot}`
      );
    }

    await this._serial(() => this.client.upload(localPath, remotePath));
    return remotePath;
  }

  /**
   * Uzak bir dosyayi yerel karsiligina indirir.
   * @returns {Promise<string>} yazilan yerel yol
   */
  async downloadFile(remotePath) {
    const connection = this.activeConnection;
    if (!connection) throw new Error('Önce bir sunucuya bağlanın.');

    const mapping = this.mappingFor(connection);
    const localPath = toLocalPath(remotePath, mapping);
    if (!localPath) {
      throw new Error(
        `Uzak yol bağlantının köküyle uyuşmuyor: ${remotePath}\nUzak kök: ${mapping.remoteRoot}`
      );
    }

    await this._serial(() => this.client.download(remotePath, localPath));
    return localPath;
  }

  /** Acik olan editordeki dosyayi yukler. */
  async uploadActiveFile() {
    const document = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
    if (!document || document.uri.scheme !== 'file') {
      vscode.window.showWarningMessage('Yüklenecek yerel bir dosya açık değil.');
      return null;
    }

    const remotePath = await this.uploadFile(document.uri.fsPath);
    vscode.window.showInformationMessage(`Yüklendi → ${remotePath}`);
    return remotePath;
  }

  /** Acik olan editordeki dosyayi indirir (veya gezginden bir uzak yol verilirse onu). */
  async downloadActiveFile(remoteOverridePath) {
    let remotePath = remoteOverridePath;

    if (!remotePath) {
      const document = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
      if (!document || document.uri.scheme !== 'file') {
        vscode.window.showWarningMessage('İndirilecek bir dosya seçili değil.');
        return null;
      }
      const connection = this.activeConnection;
      if (!connection) throw new Error('Önce bir sunucuya bağlanın.');
      remotePath = toRemotePath(document.uri.fsPath, this.mappingFor(connection));
      if (!remotePath) {
        vscode.window.showWarningMessage('Bu dosya yerel kökün dışında.');
        return null;
      }
    }

    const localPath = await this.downloadFile(remotePath);
    vscode.window.showInformationMessage(`İndirildi → ${localPath}`);
    return localPath;
  }

  /**
   * Kaydetme aninda yukleme. Ayar kapaliysa, baglanti yoksa veya dosya haric
   * listede ise sessizce cikar — kullanicinin her kaydetmede hata gormesi
   * bu ozelligi kullanilamaz hale getirir.
   */
  async handleDocumentSave(document) {
    const config = vscode.workspace.getConfiguration('vscodeFtp');
    if (!config.get('autoUploadOnSave', false)) return;
    if (!this.isConnected()) return;
    if (document.uri.scheme !== 'file') return;
    if (document.isUntitled) return;

    const localPath = document.uri.fsPath;
    if (isExcluded(localPath, config.get('uploadOnSaveExclude', []))) {
      this.logger.info(`Atlandı (hariç listesinde): ${localPath}`);
      return;
    }

    try {
      const remotePath = await this.uploadFile(localPath);
      this.logger.info(`Otomatik yükleme tamam: ${path.basename(localPath)} → ${remotePath}`);
    } catch (error) {
      this.logger.exception(`Otomatik yükleme başarısız: ${localPath}`, error);
      vscode.window.showErrorMessage(`Otomatik yükleme başarısız: ${error.message}`);
    }
  }

  async testConnection(connectionId, passwordOverride) {
    const connection = this.store.find(connectionId);
    if (!connection) throw new Error(`Bağlantı bulunamadı: ${connectionId}`);

    const password =
      passwordOverride !== undefined ? passwordOverride : await this.store.getPassword(connection.id);
    const timeout = vscode.workspace.getConfiguration('vscodeFtp').get('connectionTimeout', 15000);

    const client = createClient(connection, password, { timeout }, this.logger);
    try {
      await client.connect();
      const entries = await client.list(connection.remoteRoot || '/');
      return { ok: true, entryCount: entries.length };
    } finally {
      // Test baglantisi ana oturumu degistirmemeli; bu yuzden ayri istemci ve
      // her durumda kapatma.
      await client.disconnect().catch(() => undefined);
    }
  }
}

module.exports = { SyncManager };
