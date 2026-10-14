'use strict';

const vscode = require('vscode');
const { Logger } = require('./src/logger');
const { ConnectionStore } = require('./src/connection-store');
const { SyncManager } = require('./src/sync-manager');
const { ConnectionTreeProvider, RemoteTreeProvider } = require('./src/tree-providers');
const { normalizeRemote } = require('./src/path-map');

/**
 * FTP / SFTP eklentisi giris noktasi.
 *
 * Derleme adimi yok: bilerek duz CommonJS. Kaynagi degistirip F5'e basmak
 * yeterli, arada bir bundler katmani olmadigi icin hata ayiklama da dogrudan
 * yazilan dosyanin uzerinde calisiyor.
 */
function activate(context) {
  const logger = new Logger();
  const store = new ConnectionStore(context, logger);

  let statusBar;
  const sync = new SyncManager(store, logger, () => {
    updateStatusBar(statusBar, sync, logger);
    remoteProvider.refresh();
    connectionProvider.refresh();
  });

  const connectionProvider = new ConnectionTreeProvider(store, () => sync.activeId);
  const remoteProvider = new RemoteTreeProvider((remotePath) => sync.listRemote(remotePath));

  context.subscriptions.push(
    logger,
    logger.channel,
    store.onDidChange(() => connectionProvider.refresh()),
    vscode.window.registerTreeDataProvider('vscodeFtp.connections', connectionProvider),
    vscode.window.registerTreeDataProvider('vscodeFtp.remote', remoteProvider),
    vscode.workspace.onDidSaveTextDocument((document) => sync.handleDocumentSave(document))
  );

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'vscodeFtp.connect';
  context.subscriptions.push(statusBar);

  registerCommands(context, { store, sync, logger, connectionProvider, remoteProvider });
  updateStatusBar(statusBar, sync, logger);

  logger.info('FTP / SFTP eklentisi etkinleştirildi.');
}

function registerCommands(context, deps) {
  const { store, sync, logger, remoteProvider, connectionProvider } = deps;

  const register = (name, handler) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(name, async (...args) => {
        try {
          await handler(...args);
        } catch (error) {
          // Komutlardan firlayan hata VS Code tarafindan sessizce yutulur;
          // kullaniciya hem mesaj hem cikti kaydi veriyoruz.
          logger.exception(`Komut başarısız: ${name}`, error);
          vscode.window.showErrorMessage(error.message);
        }
      })
    );
  };

  register('vscodeFtp.addConnection', async () => {
    const collected = await promptForConnection();
    if (!collected) return;
    const saved = await store.save(collected.connection, collected.password);
    const test = await vscode.window.showInformationMessage(
      `Bağlantı kaydedildi: ${saved.name}`,
      'Bağlantıyı Test Et',
      'Bağlan'
    );
    if (test === 'Bağlantıyı Test Et') {
      await vscode.commands.executeCommand('vscodeFtp.testConnection', saved.id);
    }
    if (test === 'Bağlan') {
      await vscode.commands.executeCommand('vscodeFtp.connect', saved.id);
    }
  });

  register('vscodeFtp.editConnection', async (item) => {
    const id = typeof item === 'string' ? item : item && item.id;
    const existing = store.find(id);
    if (!existing) return;

    const collected = await promptForConnection(existing);
    if (!collected) return;
    await store.save(collected.connection, collected.password);
    vscode.window.showInformationMessage(`Bağlantı güncellendi: ${collected.connection.name}`);
  });

  register('vscodeFtp.deleteConnection', async (item) => {
    const id = typeof item === 'string' ? item : item && item.id;
    const existing = store.find(id);
    if (!existing) return;

    const confirm = await vscode.window.showWarningMessage(
      `"${existing.name}" bağlantısı silinsin mi?`,
      { modal: true },
      'Sil'
    );
    if (confirm !== 'Sil') return;

    if (sync.activeId === id) await sync.disconnect();
    await store.remove(id);
    vscode.window.showInformationMessage(`Bağlantı silindi: ${existing.name}`);
  });

  register('vscodeFtp.testConnection', async (item) => {
    const id = typeof item === 'string' ? item : item && item.id;
    const connection = store.find(id);
    if (!connection) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Bağlantı test ediliyor: ${connection.name}` },
      async () => {
        const result = await sync.testConnection(id);
        vscode.window.showInformationMessage(
          `Bağlantı başarılı — ${normalizeRemote(connection.remoteRoot)} içinde ${result.entryCount} girdi görüldü.`
        );
      }
    );
  });

  register('vscodeFtp.connect', async (item) => {
    let id = typeof item === 'string' ? item : item && item.id;

    if (!id) {
      const connections = store.list();
      if (connections.length === 0) {
        vscode.window.showWarningMessage('Kaydedilmiş bağlantı yok. Önce bir bağlantı ekleyin.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        connections.map((connection) => ({
          label: connection.name,
          description: `${connection.protocol.toUpperCase()} · ${connection.host}`,
          id: connection.id,
        })),
        { placeHolder: 'Bağlanılacak sunucuyu seçin' }
      );
      if (!picked) return;
      id = picked.id;
    }

    const connection = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Bağlanılıyor…' },
      () => sync.connect(id)
    );

    remoteProvider.setRoot(connection.remoteRoot || '/');
    vscode.window.showInformationMessage(`Bağlandı: ${connection.name}`);
  });

  register('vscodeFtp.disconnect', async () => {
    if (!sync.isConnected()) {
      vscode.window.showInformationMessage('Zaten bağlı değilsiniz.');
      return;
    }
    const name = sync.activeConnection ? sync.activeConnection.name : '';
    await sync.disconnect();
    vscode.window.showInformationMessage(`Bağlantı kesildi${name ? ': ' + name : ''}`);
  });

  register('vscodeFtp.refresh', async () => {
    connectionProvider.refresh();
    remoteProvider.refresh();
  });

  register('vscodeFtp.uploadActiveFile', async () => {
    await sync.uploadActiveFile();
  });

  register('vscodeFtp.downloadActiveFile', async (remotePath) => {
    await sync.downloadActiveFile(typeof remotePath === 'string' ? remotePath : undefined);
  });
}

/**
 * Baglanti ekleme/duzenleme formu. Adim adim soruyor cunku tek bir
 * showInputBox'a "host, port, user, pass" sigdirmak kullaniciyi yoruyor.
 */
async function promptForConnection(existing) {
  const workspaceName =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].name
      : 'global';

  const name = await vscode.window.showInputBox({
    title: 'Bağlantı adı',
    value: existing ? existing.name : workspaceName,
    prompt: 'Bu bağlantıyı listede nasıl görmek istersiniz?',
    validateInput: (value) => (value.trim() ? undefined : 'Ad boş olamaz.'),
  });
  if (name === undefined) return null;

  const protocol = await vscode.window.showQuickPick(
    [
      { label: 'FTP', description: 'Klasik FTP veya FTPS', id: 'ftp' },
      { label: 'SFTP', description: 'SSH üzerinden dosya transferi (önerilen)', id: 'sftp' },
    ],
    { title: 'Protokol', placeHolder: 'Protokol seçin' }
  );
  if (!protocol) return null;

  const host = await vscode.window.showInputBox({
    title: 'Sunucu',
    value: existing ? existing.host : '',
    prompt: 'Örnek: ftp.ornek.com veya 203.0.113.10',
    validateInput: (value) => (value.trim() ? undefined : 'Sunucu adresi boş olamaz.'),
  });
  if (host === undefined) return null;

  const port = await vscode.window.showInputBox({
    title: 'Port',
    value: String(existing ? existing.port : protocol.id === 'sftp' ? 22 : 21),
    prompt: protocol.id === 'sftp' ? 'SFTP için genellikle 22' : 'FTP için genellikle 21',
    validateInput: (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return 'Geçerli bir port girin (1-65535).';
      }
      return undefined;
    },
  });
  if (port === undefined) return null;

  const user = await vscode.window.showInputBox({
    title: 'Kullanıcı adı',
    value: existing ? existing.user : '',
    prompt: 'Sunucu kullanıcı adınız',
  });
  if (user === undefined) return null;

  const password = await vscode.window.showInputBox({
    title: 'Şifre',
    password: true,
    prompt: 'İşletim sisteminin anahtar zincirinde saklanır, ayar dosyasına yazılmaz.',
    placeHolder: existing ? '(değiştirmek istemiyorsanız boş bırakın)' : '',
  });
  if (password === undefined) return null;

  const scope = await vscode.window.showQuickPick(
    [
      { label: 'Bu workspace', description: 'Yalnızca bu projede görünür', id: 'workspace' },
      { label: 'Genel', description: 'Bütün pencerelerde görünür', id: 'global' },
    ],
    { title: 'Kapsam', placeHolder: 'Bağlantı nerede görünsün?' }
  );
  if (!scope) return null;

  const remoteRoot = await vscode.window.showInputBox({
    title: 'Uzak kök dizin',
    value: existing ? existing.remoteRoot : '/',
    prompt: 'Yerel workspace klasörünün karşılık geldiği uzak dizin',
  });
  if (remoteRoot === undefined) return null;

  const localRoot = await vscode.window.showInputBox({
    title: 'Yerel kök dizin',
    value: existing ? existing.localRoot : '',
    prompt: 'Boş bırakırsanız açık olan workspace klasörü kullanılır.',
  });
  if (localRoot === undefined) return null;

  return {
    connection: {
      id: existing ? existing.id : undefined,
      name: name.trim(),
      protocol: protocol.id,
      host: host.trim(),
      port: Number(port),
      user: user.trim(),
      remoteRoot: normalizeRemote(remoteRoot),
      localRoot: localRoot.trim(),
      scope: scope.id,
    },
    password,
  };
}

function updateStatusBar(statusBar, sync, logger) {
  if (!statusBar) return;
  const connection = sync.activeConnection;
  if (connection) {
    statusBar.text = `$(plug) ${connection.name}`;
    statusBar.tooltip = `Bağlı: ${connection.protocol.toUpperCase()} ${connection.host}:${connection.port}`;
    statusBar.color = undefined;
  } else {
    statusBar.text = '$(plug) FTP';
    statusBar.tooltip = 'Bağlı değil — bağlanmak için tıklayın';
  }
  statusBar.show();
}

function deactivate() {
  // Abonelikler context.subscriptions uzerinden temizleniyor.
}

module.exports = { activate, deactivate };
