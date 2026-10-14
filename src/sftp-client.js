'use strict';

const fs = require('fs');
const path = require('path');
const SftpClientLib = require('ssh2-sftp-client');
const { normalizeRemote } = require('./path-map');

/**
 * SFTP istemcisi. FtpClient ile birebir ayni arayuzu sunar.
 *
 * Dikkat: ssh2-sftp-client alan adi olarak "username" bekler, basic-ftp ise "user".
 * Iki kutuphane arasindaki bu tur kucuk farklar yuzunden protokol secimi tek bir
 * yerde (create-client) yapiliyor, ust katman hep ayni sekli goruyor.
 */
class SftpClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.client = null;
    this.protocol = 'sftp';
  }

  static get supports() {
    return ['sftp'];
  }

  async connect() {
    this.client = new SftpClientLib();

    const options = {
      host: this.config.host,
      port: this.config.port || 22,
      username: this.config.user,
      readyTimeout: this.config.timeout || 15000,
    };

    if (this.config.privateKeyPath) {
      // Parola yerine anahtar dosyasi verildiyse onu kullaniyoruz.
      options.privateKey = await fs.promises.readFile(this.config.privateKeyPath);
      if (this.config.password) options.passphrase = this.config.password;
    } else {
      options.password = this.config.password || '';
    }

    await this.client.connect(options);
    this.logger.info(`SFTP baglantisi kuruldu: ${this.config.host}:${this.config.port || 22}`);
  }

  /** @returns {Promise<Array<{name: string, type: 'file'|'directory', size: number, modifiedAt: Date|null}>>} */
  async list(remoteDir) {
    const entries = await this.client.list(normalizeRemote(remoteDir));
    return entries
      .filter((entry) => entry.name !== '.' && entry.name !== '..')
      .map((entry) => ({
        name: entry.name,
        // ssh2-sftp-client: 'd' klasor, '-' dosya, 'l' sembolik bag
        type: entry.type === 'd' ? 'directory' : 'file',
        size: entry.size || 0,
        modifiedAt: entry.modifyTime ? new Date(entry.modifyTime) : null,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'tr');
      });
  }

  async download(remotePath, localPath) {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await this.client.get(normalizeRemote(remotePath), localPath);
    this.logger.info(`Indirildi: ${remotePath} -> ${localPath}`);
  }

  async upload(localPath, remotePath) {
    const target = normalizeRemote(remotePath);
    const parent = path.posix.dirname(target);
    if (parent && parent !== '/' && parent !== '.') {
      // recursive: true -> aradaki klasorler yoksa olusturulur, varsa sessizce gecilir.
      await this.client.mkdir(parent, true);
    }
    await this.client.put(localPath, target);
    this.logger.info(`Yuklendi: ${localPath} -> ${target}`);
  }

  async mkdir(remotePath) {
    await this.client.mkdir(normalizeRemote(remotePath), true);
  }

  async remove(remotePath) {
    await this.client.delete(normalizeRemote(remotePath));
  }

  async rename(from, to) {
    await this.client.rename(normalizeRemote(from), normalizeRemote(to));
  }

  async disconnect() {
    if (this.client) {
      await this.client.end();
      this.client = null;
      this.logger.info('SFTP baglantisi kapatildi.');
    }
  }
}

module.exports = { SftpClient };
