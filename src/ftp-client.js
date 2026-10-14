'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('basic-ftp');
const { normalizeRemote } = require('./path-map');

/**
 * Klasik FTP (ve FTPS) istemcisi. basic-ftp uzerine ince bir sarmalayici:
 * amac, SFTP ile ayni arayuzu sunmak ki ust katman protokolu hic bilmesin.
 */
class FtpClient {
  /**
   * @param {{host: string, port: number, user: string, password: string, secure: boolean, timeout: number}} config
   * @param {import('./logger').Logger} logger
   */
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.client = null;
    this.protocol = 'ftp';
  }

  static get supports() {
    return ['ftp'];
  }

  async connect() {
    this.client = new Client(this.config.timeout || 15000);

    // Ayrintili protokol dokumu cok gurultulu; yalnizca kullanici isterse aciliyor.
    this.client.ftp.verbose = false;

    await this.client.access({
      host: this.config.host,
      port: this.config.port || 21,
      user: this.config.user || 'anonymous',
      password: this.config.password || '',
      secure: Boolean(this.config.secure),
      // Kendinden imzali sertifika kullanan sunucular yaygin; bu tur bir arac
      // icin baglantiyi tamamen bloklamak yerine baglanip uyarmak daha faydali.
      secureOptions: this.config.secure ? { rejectUnauthorized: false } : undefined,
    });

    this.logger.info(`FTP baglantisi kuruldu: ${this.config.host}:${this.config.port || 21}`);
  }

  /** @returns {Promise<Array<{name: string, type: 'file'|'directory', size: number, modifiedAt: Date|null}>>} */
  async list(remoteDir) {
    const entries = await this.client.list(normalizeRemote(remoteDir));
    return entries
      .filter((entry) => entry.name !== '.' && entry.name !== '..')
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory ? 'directory' : 'file',
        size: entry.size || 0,
        modifiedAt: entry.modifiedAt || null,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'tr');
      });
  }

  async download(remotePath, localPath) {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await this.client.downloadTo(localPath, normalizeRemote(remotePath));
    this.logger.info(`Indirildi: ${remotePath} -> ${localPath}`);
  }

  async upload(localPath, remotePath) {
    const target = normalizeRemote(remotePath);
    const parent = path.posix.dirname(target);
    if (parent && parent !== '/' && parent !== '.') {
      await this.client.ensureDir(parent);
    }
    await this.client.uploadFrom(localPath, target);
    this.logger.info(`Yuklendi: ${localPath} -> ${target}`);
  }

  async mkdir(remotePath) {
    await this.client.ensureDir(normalizeRemote(remotePath));
  }

  async remove(remotePath) {
    await this.client.remove(normalizeRemote(remotePath));
  }

  async rename(from, to) {
    await this.client.rename(normalizeRemote(from), normalizeRemote(to));
  }

  async disconnect() {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.logger.info('FTP baglantisi kapatildi.');
    }
  }
}

module.exports = { FtpClient };
