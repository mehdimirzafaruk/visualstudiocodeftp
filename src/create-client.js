'use strict';

const { FtpClient } = require('./ftp-client');
const { SftpClient } = require('./sftp-client');

const IMPLEMENTATIONS = {
  ftp: FtpClient,
  sftp: SftpClient,
};

/**
 * Baglanti tanimindan uygun istemciyi uretir. Protokol secimi tek noktada:
 * ust katman (sync-manager, tree provider) hep ayni arayuzu cagirir.
 *
 * @param {object} connection  ConnectionStore kaydi
 * @param {string|undefined} password
 * @param {{timeout?: number, privateKeyPath?: string, secure?: boolean}} options
 * @param {import('./logger').Logger} logger
 */
function createClient(connection, password, options, logger) {
  const Implementation = IMPLEMENTATIONS[connection.protocol];
  if (!Implementation) {
    throw new Error(`Desteklenmeyen protokol: ${connection.protocol}`);
  }

  const config = {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: password || '',
    secure: options.secure !== undefined ? options.secure : Boolean(connection.secure),
    timeout: options.timeout || 15000,
    privateKeyPath: options.privateKeyPath,
  };

  return new Implementation(config, logger);
}

module.exports = { createClient, IMPLEMENTATIONS };
