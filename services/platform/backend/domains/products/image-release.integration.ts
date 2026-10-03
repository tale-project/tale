/**
 * Real Postgres and the object-store pin: replacing or removing a product's
 * managed image reclaims its bytes only when nothing holds them (#4110). The
 * release kept its own copy of the holder rule (file rows and a document's
 * current file), while the task door takes a ref whose file row names the
 * caller as its uploader, and the image's row does. So an image a task
 * listed lost its bytes on a replace or a product delete, and the card kept
 * listing a file every run start met as missing. Every product write here
 * goes through the session door; every verdict on the bytes is a HEAD
 * against the store.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  itestObjectStore,
  type RecordCheck,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import {
  resolveObjectStore,
  s3DeleteObject,
  s3HeadObject,
} from '../../lib/object-store.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';
import { productImageId } from './image-url.ts';

interface Actor {
  cookie: string;
  userId: string;
}

interface Image {
  imageUrl: string;
  fileId: string;
  storageRef: string;
}

/** A 1×1 PNG: the image door sniffs the bytes, never the header. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export async function checkProductImageReleaseHolders(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  signUpMember: (label: string, role: string) => Promise<Actor>,
  record: RecordCheck,
): Promise<void> {
  const objectStore = itestObjectStore();
  if (!objectStore) {
    recordSkip(
      record,
      'product image release',
      'no ITEST_S3_ENDPOINT — S3 lanes not exercised in this run',
    );
    return;
  }
  const { orgId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const slugRows = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId} LIMIT 1
  `;
  const orgSlug = slugRows[0]?.slug ?? '';
  // A filtered run may not have run checkFiles, which seeds the default
  // store; keep a configured one intact so earlier lanes' blobs stay put.
  try {
    await resolveObjectStore(orgSlug);
  } catch {
    await ensureDefaultObjectStore(sql, {
      OBJECT_STORE_ENDPOINT: objectStore.endpoint,
      OBJECT_STORE_BUCKET: `itest-product-image-${suffix}`,
      OBJECT_STORE_ACCESS_KEY: objectStore.accessKeyId,
      OBJECT_STORE_SECRET_KEY: objectStore.secretAccessKey,
    });
  }
  const store = await resolveObjectStore(orgSlug);
  // Its own uploader, so the lane neither spends the shared user's upload
  // budget nor depends on what earlier lanes left in it.
  const owner = await signUpMember(`product-image-owner-${suffix}`, 'admin');
  const projectId = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${projectId}, ${orgId}, 'Product image probe', ${owner.userId},
            ${now}, ${now})
  `;

  const call = (method: string, route: string, body?: unknown) =>
    fetch(`${base}/api/app/${route}?orgId=${orgId}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: owner.cookie,
        origin: base,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const keyOf = (ref: string) => (ref.startsWith('s3:') ? ref.slice(3) : ref);
  const present = async (ref: string): Promise<boolean> =>
    (await s3HeadObject(store, keyOf(ref))) !== null;
  const refs: string[] = [];
  const productIds: string[] = [];
  /** The image door: sniffed bytes, registered at once as the uploader's. */
  const uploadImage = async (label: string): Promise<Image> => {
    const response = await fetch(
      `${base}/api/app/products/images?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          cookie: owner.cookie,
          origin: base,
        },
        body: PNG,
      },
    );
    const parsed = z
      .object({ imageUrl: z.string() })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error(`image ${label}: ${response.status}`);
    const fileId = productImageId(parsed.data.imageUrl, orgId);
    if (fileId === null) throw new Error(`image ${label}: unmanaged URL`);
    const rows = await sql<{ storageRef: string }[]>`
      SELECT storage_ref AS "storageRef" FROM app.file_metadata
      WHERE id = ${fileId}
    `;
    const storageRef = rows[0]?.storageRef;
    if (storageRef === undefined) throw new Error(`image ${label}: no row`);
    refs.push(storageRef);
    return { imageUrl: parsed.data.imageUrl, fileId, storageRef };
  };
  const createProduct = async (label: string, image: Image) => {
    const response = await call('POST', 'products', {
      name: `Product image probe ${label} ${suffix}`,
      imageUrl: image.imageUrl,
    });
    const parsed = z
      .object({ productId: z.string() })
      .safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new Error(`product ${label}: ${response.status}`);
    productIds.push(parsed.data.productId);
    return parsed.data.productId;
  };
  const replaceImage = async (productId: string, image: Image) =>
    (await call('POST', `products/${productId}`, { imageUrl: image.imageUrl }))
      .status;
  const removeProduct = async (productId: string) =>
    (await call('DELETE', `products/${productId}`)).status;
  /** The reach: the image URL names the file, the files door its ref. */
  const readRef = async (image: Image) => {
    const response = await call('GET', `files/${image.fileId}`);
    const parsed = z
      .object({ file: z.object({ storageRef: z.string() }) })
      .safeParse(await response.json().catch(() => null));
    return {
      status: response.status,
      storageRef: parsed.success ? parsed.data.file.storageRef : null,
    };
  };
  /** The task door with `ref` as the new task's attachment. */
  const attach = async (ref: string, label: string) => {
    const response = await call('POST', 'tasks', {
      projectId,
      title: `Product image probe: ${label}`,
      attachments: [
        {
          fileId: ref,
          fileName: `${label}.png`,
          fileType: 'image/png',
          fileSize: PNG.byteLength,
        },
      ],
    });
    const parsed = z
      .object({ taskId: z.string() })
      .safeParse(await response.json().catch(() => null));
    return {
      status: response.status,
      taskId: parsed.success ? parsed.data.taskId : null,
    };
  };
  const listed = async (taskId: string | null, ref: string) => {
    if (taskId === null) return false;
    const rows = await sql<{ listed: boolean }[]>`
      SELECT coalesce(attachments, '[]'::jsonb)
             @> jsonb_build_array(jsonb_build_object('fileId', ${ref}::text))
             AS listed
      FROM app.tasks WHERE id = ${taskId}
    `;
    return rows[0]?.listed ?? false;
  };
  const rowGone = async (image: Image) =>
    (
      await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM app.file_metadata
        WHERE id = ${image.fileId}
      `
    )[0]?.n === 0;

  try {
    // The controls the fix must keep: an image nothing else holds goes with
    // its row on a replace and on a product delete.
    const cOld = await uploadImage('c-old');
    const cProduct = await createProduct('c', cOld);
    const cNew = await uploadImage('c-new');
    const cReplace = await replaceImage(cProduct, cNew);
    const cGone = !(await present(cOld.storageRef));
    const cRowGone = await rowGone(cOld);
    const cNewKept = await present(cNew.storageRef);
    const dOld = await uploadImage('c-deleted');
    const dProduct = await createProduct('c-deleted', dOld);
    const dRemove = await removeProduct(dProduct);
    const dGone = !(await present(dOld.storageRef));
    const dRowGone = await rowGone(dOld);
    record(
      'a product image nothing else holds is reclaimed on a replace and with its product',
      cReplace === 200 &&
        cGone &&
        cRowGone &&
        cNewKept &&
        dRemove === 200 &&
        dGone &&
        dRowGone,
      `replace=${cReplace} old bytes gone=${cGone} row gone=${cRowGone} new kept=${cNewKept} (want 200/true/true/true); delete=${dRemove} bytes gone=${dGone} row gone=${dRowGone} (want 200/true/true)`,
    );

    // The finding: a task lists the image by the ref the files door hands
    // its uploader, then the product lets the image go.
    const hOld = await uploadImage('h-old');
    const hProduct = await createProduct('h', hOld);
    const hRead = await readRef(hOld);
    const hTask = await attach(hRead.storageRef ?? hOld.storageRef, 'h');
    const hNew = await uploadImage('h-new');
    const hReplace = await replaceImage(hProduct, hNew);
    const hKept = await present(hOld.storageRef);
    const hListed = await listed(hTask.taskId, hOld.storageRef);
    const hRowGone = await rowGone(hOld);
    record(
      'replacing a product image keeps the bytes a task lists (#4110)',
      hRead.status === 200 &&
        hRead.storageRef === hOld.storageRef &&
        hTask.status === 200 &&
        hReplace === 200 &&
        hKept &&
        hListed,
      `files door=${hRead.status}/same ref=${hRead.storageRef === hOld.storageRef} (want 200/true), attach=${hTask.status} (want 200), replace=${hReplace} (want 200), kept=${hKept} listed=${hListed} (want true/true), image row gone=${hRowGone}`,
    );

    const h2 = await uploadImage('h2');
    const h2Product = await createProduct('h2', h2);
    const h2Read = await readRef(h2);
    const h2Task = await attach(h2Read.storageRef ?? h2.storageRef, 'h2');
    const h2Remove = await removeProduct(h2Product);
    const h2Kept = await present(h2.storageRef);
    const h2Listed = await listed(h2Task.taskId, h2.storageRef);
    const h2RowGone = await rowGone(h2);
    record(
      'deleting a product keeps the image bytes a task lists (#4110)',
      h2Read.status === 200 &&
        h2Task.status === 200 &&
        h2Remove === 200 &&
        h2Kept &&
        h2Listed,
      `files door=${h2Read.status} (want 200), attach=${h2Task.status} (want 200), delete=${h2Remove} (want 200), kept=${h2Kept} listed=${h2Listed} (want true/true), image row gone=${h2RowGone}`,
    );

    // Every other holder of the one rule counts as well: a task's
    // deliverable, a document's current file or retained version, and a
    // second file row naming the same bytes.
    const holders: [string, (image: Image) => Promise<unknown>][] = [
      [
        'task outputs',
        (image) => sql`
          INSERT INTO app.tasks (
            org_id, project_id, title, status, rank, created_by,
            created_by_type, outputs, created_at_ms, updated_at_ms
          ) VALUES (
            ${orgId}, ${projectId}, 'Task delivering a product image', 'todo',
            ${`r-${suffix}`}, ${owner.userId}, 'user',
            ${sql.json([{ fileId: image.storageRef, fileName: 'out.png', fileType: 'image/png', fileSize: PNG.byteLength }])},
            ${now}, ${now}
          )
        `,
      ],
      [
        'document file_ref',
        (image) => sql`
          INSERT INTO app.documents (id, org_id, file_ref, created_at_ms,
                                     updated_at_ms)
          VALUES (${randomUUID()}, ${orgId}, ${image.storageRef}, ${now},
                  ${now})
        `,
      ],
      [
        'document history_files',
        (image) => sql`
          INSERT INTO app.documents (id, org_id, file_ref, history_files,
                                     created_at_ms, updated_at_ms)
          VALUES (${randomUUID()}, ${orgId}, NULL, ${[image.storageRef]},
                  ${now}, ${now})
        `,
      ],
      [
        'another file row',
        (image) => sql`
          INSERT INTO app.file_metadata (
            org_id, file_name, content_type, size, storage_ref, uploaded_by,
            created_at_ms
          ) VALUES (
            ${orgId}, 'copy.png', 'image/png', ${PNG.byteLength},
            ${image.storageRef}, ${owner.userId}, ${now}
          )
        `,
      ],
    ];
    const verdicts: string[] = [];
    let everyHolderKept = true;
    for (const [holder, hold] of holders) {
      const image = await uploadImage(holder);
      const productId = await createProduct(holder, image);
      await hold(image);
      const removed = await removeProduct(productId);
      const kept = await present(image.storageRef);
      everyHolderKept &&= removed === 200 && kept;
      verdicts.push(`${holder}: delete=${removed}/kept=${kept}`);
    }
    record(
      'deleting a product keeps the image bytes a task deliverable, a document or another file row holds',
      everyHolderKept,
      `${verdicts.join(', ')} (want 200/true each)`,
    );
  } catch (error) {
    // Recorded, never thrown: a thrown lane truncates every later lane.
    record(
      'product image release lane runs to completion',
      false,
      `threw ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    // Leave no probe bytes or rows behind; the project cascades its tasks.
    for (const ref of refs) {
      await s3DeleteObject(store, keyOf(ref)).catch((error: unknown) =>
        console.warn('[itest] product image probe cleanup failed:', error),
      );
    }
    await sql`DELETE FROM app.products WHERE id = ANY(${productIds})`;
    await sql`DELETE FROM app.documents WHERE org_id = ${orgId}
      AND (file_ref = ANY(${refs}) OR history_files && ${refs}::text[])`;
    await sql`DELETE FROM app.file_metadata WHERE org_id = ${orgId}
      AND storage_ref = ANY(${refs})`;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
