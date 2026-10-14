'use strict';

const vscode = require('vscode');
const { normalizeRemote, joinRemote } = require('./path-map');

/**
 * Sol paneldeki "Baglantilar" listesi.
 */
class ConnectionTreeProvider {
  /**
   * @param {import('./connection-store').ConnectionStore} store
   * @param {(id: string) => string|null} activeConnectionId
   */
  constructor(store, activeConnectionId) {
    this.store = store;
    this.activeConnectionId = activeConnectionId;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element) {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.contextValue = 'connection';
    item.description = `${element.protocol.toUpperCase()} · ${element.host}`;
    item.tooltip = [
      `${element.protocol.toUpperCase()} ${element.host}:${element.port}`,
      `Kullanıcı: ${element.user || '(yok)'}`,
      `Uzak kök: ${normalizeRemote(element.remoteRoot)}`,
      `Kapsam: ${element.scope === 'global' ? 'Genel' : 'Bu workspace'}`,
    ].join('\n');

    // Aktif baglanti gorsel olarak ayrilsin; hangi sunucuda oldugunu bilmemek
    // yanlis dosyayi yanlis yere yazmanin en kolay yolu.
    if (element.id === this.activeConnectionId()) {
      item.iconPath = new vscode.ThemeIcon('plug', new vscode.ThemeColor('charts.green'));
    } else {
      item.iconPath = new vscode.ThemeIcon('plug');
    }

    item.command = {
      command: 'vscodeFtp.connect',
      title: 'Bağlan',
      arguments: [element.id],
    };
    return item;
  }

  getChildren(element) {
    if (element) return [];
    return this.store.list();
  }
}

/**
 * Uzak dosya gezgini. Klasorler tembel acilir: sunucudan yalnizca o an acilan
 * klasorun icerigi istenir, tum agac bastan cekilmez.
 */
class RemoteTreeProvider {
  /**
   * @param {(remotePath: string) => Promise<Array<{name: string, type: string, size: number}>>} listFn
   */
  constructor(listFn) {
    this.listFn = listFn;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.rootPath = '/';
  }

  setRoot(remotePath) {
    this.rootPath = normalizeRemote(remotePath);
    this.refresh();
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element) {
    const collapsible =
      element.type === 'directory'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.name, collapsible);
    item.id = element.path;
    item.contextValue = element.type === 'directory' ? 'remoteDirectory' : 'remoteFile';
    item.tooltip = `${element.path}\n${formatSize(element.size)}`;

    if (element.type === 'directory') {
      item.iconPath = vscode.ThemeIcon.Folder;
    } else {
      item.iconPath = vscode.ThemeIcon.File;
      item.description = formatSize(element.size);
      item.command = {
        command: 'vscodeFtp.downloadActiveFile',
        title: 'İndir',
        arguments: [element.path],
      };
    }
    return item;
  }

  async getChildren(element) {
    const remotePath = element ? element.path : this.rootPath;
    try {
      const entries = await this.listFn(remotePath);
      return entries.map((entry) => ({
        ...entry,
        path: joinRemote(remotePath, entry.name),
      }));
    } catch (error) {
      // Baglanti yoksa vscode agaci bos donerse kullanici nedenini anlamaz;
      // hatayi burada yutmak yerine gosteriyoruz.
      vscode.window.showErrorMessage(`Uzak dizin okunamadı: ${error.message}`);
      return [];
    }
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

module.exports = { ConnectionTreeProvider, RemoteTreeProvider, formatSize };
