import 'server-only';

import { Client, ConnectConfig } from 'ssh2';
import * as net from 'net';

export interface SSHTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  // Remote DB host and port as seen from the SSH server
  // Auto-parsed from connection string if not provided
  remoteHost?: string;
  remotePort?: number;
}

export class SSHTunnel {
  private client: Client;
  private server: net.Server | null = null;
  localPort: number = 0;

  constructor(private config: SSHTunnelConfig) {
    this.client = new Client();
  }

  connect(): Promise<number> {
    return new Promise((resolve, reject) => {
      const remoteHost = this.config.remoteHost || '127.0.0.1';
      const remotePort = this.config.remotePort || 5432;

      this.client.on('ready', () => {
        this.server = net.createServer((socket) => {
          this.client.forwardOut(
            '127.0.0.1',
            0,
            remoteHost,
            remotePort,
            (err, stream) => {
              if (err) {
                socket.destroy();
                return;
              }
              socket.pipe(stream);
              stream.pipe(socket);
              stream.on('close', () => socket.destroy());
              socket.on('close', () => {
                try { stream.destroy(); } catch { /* ignore */ }
              });
            }
          );
        });

        this.server.listen(0, '127.0.0.1', () => {
          const addr = this.server!.address() as net.AddressInfo;
          this.localPort = addr.port;
          resolve(this.localPort);
        });

        this.server.on('error', (err) => {
          reject(new Error(`SSH tunnel local server error: ${err.message}`));
        });
      });

      this.client.on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: 15000,
      };

      if (this.config.authMethod === 'password') {
        connectConfig.password = this.config.password;
      } else if (this.config.privateKey) {
        connectConfig.privateKey = this.config.privateKey;
        if (this.config.passphrase) {
          connectConfig.passphrase = this.config.passphrase;
        }
      }

      this.client.connect(connectConfig);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        try {
          this.client.end();
          this.client.destroy();
        } catch { /* ignore */ }
        resolve();
      };

      if (this.server) {
        this.server.close(() => {
          this.server = null;
          done();
        });
        // Force close any open connections (Node 18.2+)
        (this.server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      } else {
        done();
      }
    });
  }
}
