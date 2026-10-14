'use strict';

const vscode = require('vscode');

/**
 * Cikti kanali. Kullanici "FTP / SFTP" panelini actiginda ne oldugunu gormeli:
 * hangi sunucuya baglanildi, hangi dosya yuklendi, hangi istek patladi. Sessiz
 * basarisizlik bu tur bir eklentide en sinir bozucu sey.
 */
class Logger {
  constructor() {
    this.channel = vscode.window.createOutputChannel('FTP / SFTP');
  }

  line(level, message) {
    const stamp = new Date().toISOString().slice(11, 19);
    this.channel.appendLine(`[${stamp}] ${level.padEnd(5)} ${message}`);
  }

  info(message) {
    this.line('INFO', message);
  }

  warn(message) {
    this.line('WARN', message);
  }

  error(message) {
    this.line('ERROR', message);
  }

  /** Yakalanan hatayi yigin iziyle birlikte yazar. */
  exception(message, error) {
    const detail = error && error.stack ? error.stack : String(error);
    this.line('ERROR', `${message}\n${detail}`);
  }

  show() {
    this.channel.show(true);
  }

  dispose() {
    this.channel.dispose();
  }
}

module.exports = { Logger };
