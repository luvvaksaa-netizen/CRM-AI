import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { DATA_DIR } from '../config';

const dbPath = path.join(DATA_DIR, 'debouncer.sqlite');

export interface PendingMessageBatch {
    messages: string[];
    mediaContexts: string[];
    tempPaths: string[];
    senderName: string;
    lastMessageRaw: any; // we can't persist complex objects easily, so we might only store strings
}

// Since storing WWebJS Message objects is impossible across restarts, 
// a crash will lose the ability to quote the exact message. 
// But we can at least save the text and recover the conversation.

class DebouncerService {
    private db: sqlite3.Database;

    constructor() {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('[Debouncer] Failed to open SQLite:', err.message);
            } else {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS pending_batches (
                        id TEXT PRIMARY KEY,
                        storeWaId TEXT,
                        contactId TEXT,
                        messages TEXT,
                        mediaContexts TEXT,
                        tempPaths TEXT,
                        senderName TEXT,
                        queuedAt INTEGER
                    )
                `);
            }
        });
    }

    public async saveBatch(
        storeWaId: string, 
        contactId: string, 
        messages: string[], 
        mediaContexts: string[], 
        tempPaths: string[], 
        senderName: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const id = `${storeWaId}_${contactId}`;
            const query = `
                INSERT INTO pending_batches (id, storeWaId, contactId, messages, mediaContexts, tempPaths, senderName, queuedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                    messages = excluded.messages,
                    mediaContexts = excluded.mediaContexts,
                    tempPaths = excluded.tempPaths,
                    senderName = excluded.senderName,
                    queuedAt = excluded.queuedAt
            `;
            this.db.run(query, [
                id, storeWaId, contactId, 
                JSON.stringify(messages), 
                JSON.stringify(mediaContexts), 
                JSON.stringify(tempPaths), 
                senderName,
                Date.now()
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    public async deleteBatch(storeWaId: string, contactId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const id = `${storeWaId}_${contactId}`;
            this.db.run(`DELETE FROM pending_batches WHERE id = ?`, [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    public async loadAllBatches(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT * FROM pending_batches`, (err, rows: any[]) => {
                if (err) reject(err);
                else {
                    const parsed = rows.map(r => ({
                        storeWaId: r.storeWaId,
                        contactId: r.contactId,
                        messages: JSON.parse(r.messages || '[]'),
                        mediaContexts: JSON.parse(r.mediaContexts || '[]'),
                        tempPaths: JSON.parse(r.tempPaths || '[]'),
                        senderName: r.senderName,
                        queuedAt: r.queuedAt
                    }));
                    resolve(parsed);
                }
            });
        });
    }
}

export const debouncerDB = new DebouncerService();
