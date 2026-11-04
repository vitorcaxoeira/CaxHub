import assert from "node:assert/strict";
import { test } from "node:test";
import { ehHeic } from "./comprovanteHeic";

test("ehHeic: pelo tipo informado (Safari/iPhone e Windows com a extensão HEIF instalada)", () => {
  for (const tipo of ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]) assert.equal(ehHeic("foto", tipo), true);
});

test("ehHeic: pela extensão quando o navegador não informa o tipo (Chrome/Edge no Windows)", () => {
  assert.equal(ehHeic("IMG_7623.HEIC", ""), true);
  assert.equal(ehHeic("IMG_0408.heic", "application/octet-stream"), true);
  assert.equal(ehHeic("scan.heif", ""), true);
});

test("ehHeic: outros arquivos não, mesmo sem tipo; extensão .heic com outro tipo declarado também não", () => {
  assert.equal(ehHeic("nota.jpg", ""), false);
  assert.equal(ehHeic("nota.pdf", "application/octet-stream"), false);
  assert.equal(ehHeic("falso.heic", "text/plain"), false);
});
