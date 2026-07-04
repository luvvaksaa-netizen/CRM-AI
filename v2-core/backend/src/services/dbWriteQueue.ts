/**
 * dbWriteQueue.ts — SQLite Write Serializer
 *
 * SQLite hanya support 1 writer dalam satu waktu. Dengan 8 WA × 25 AI reply
 * concurrent, 50+ operasi write bersamaan menghasilkan SQLITE_BUSY.
 *
 * Queue ini menserialkan semua write operation menjadi 1 per 1,
 * mengeliminasi SQLITE_BUSY hampir sepenuhnya.
 *
 * Import ini di chatHistory.service.ts dan message_handler.js.
 */

type Task<T> = () => Promise<T>;

interface QueueItem<T> {
  task: Task<T>;
  resolve: (value: T) => void;
  reject: (err: any) => void;
}

const queue: QueueItem<any>[] = [];
let isProcessing = false;

function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const item = queue.shift()!;
  item.task()
    .then(item.resolve)
    .catch(item.reject)
    .finally(() => {
      isProcessing = false;
      // Process next item immediately (microtask)
      setImmediate(processQueue);
    });
}

/**
 * Antri operasi write ke SQLite. Return Promise yang resolve ketika operasi selesai.
 * Semua operasi dijalankan SATU PER SATU — tidak akan SQLITE_BUSY.
 */
export function enqueueWrite<T>(task: Task<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ task, resolve, reject });
    processQueue();
  });
}

/**
 * Return jumlah item yang sedang antri (untuk monitoring).
 */
export function getQueueLength(): number {
  return queue.length;
}
