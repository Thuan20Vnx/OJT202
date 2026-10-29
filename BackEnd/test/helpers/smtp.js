import { SMTPServer } from 'smtp-server';

/** An actual SMTP receiver bound to loopback. Never connects to Gmail. */
export async function smtpSandbox(t, config) {
  const messages = [];
  const state = { reject: false };
  const server = new SMTPServer({
    secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username !== 'smtp-test' || auth.password !== 'local-test-password') return callback(new Error('Authentication failed'));
      callback(null, { user: auth.username });
    },
    onRcptTo(_address, _session, callback) {
      callback(state.reject ? Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 }) : undefined);
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        messages.push({ envelope: session.envelope, raw: Buffer.concat(chunks).toString('utf8').replace(/=\r?\n/g, '').replace(/=3D/g, '=') });
        callback();
      });
      stream.on('error', callback);
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const previous = config.mail;
  config.mail = { mode: 'smtp', host: '127.0.0.1', port: server.server.address().port,
    secure: false, requireTLS: false, user: 'smtp-test', pass: 'local-test-password', from: 'TaskFlow <sender@example.test>' };
  t.after(async () => {
    config.mail = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  return { messages, state };
}
