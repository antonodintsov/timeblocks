/* Chronoblock: переносимые конфигурации без сервера. */
window.ChronoConfig = (() => {
  'use strict';
  const MAX_BLOCKS = 100;
  const MAX_URL_PAYLOAD = 24000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  function normalize(source) {
    if (!source || typeof source !== 'object' || !Array.isArray(source.blocks)) {
      throw new Error('Неверный формат конфигурации');
    }
    if (source.blocks.length > MAX_BLOCKS) throw new Error('Слишком много блоков (максимум 100)');
    const overtime = source.settings?.overtimeSeconds;
    if (!Number.isInteger(overtime) || overtime < 0 || overtime > 600) {
      throw new Error('Некорректное значение овертайма');
    }
    const blocks = source.blocks.map(b => {
      if (!b || typeof b.name !== 'string' || !b.name.trim() ||
          [...b.name].length > 60 || !Number.isInteger(b.durationMin) ||
          b.durationMin < 1 || b.durationMin > 120) {
        throw new Error('Некорректное название или длительность блока');
      }
      return { name: b.name.trim(), durationMin: b.durationMin };
    });
    return { v: 1, settings: { overtimeSeconds: overtime }, blocks };
  }

  function canonical(source) {
    const c = normalize(source);
    return JSON.stringify({ v: 1, s: c.settings.overtimeSeconds,
      b: c.blocks.map(b => [b.name, b.durationMin]) });
  }

  function fromCompact(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.b)) throw new Error('Неизвестная версия ссылки');
    return normalize({ settings: { overtimeSeconds: raw.s },
      blocks: raw.b.map(b => {
        if (!Array.isArray(b) || b.length !== 2) throw new Error('Повреждённый блок');
        return { name: b[0], durationMin: b[1] };
      }) });
  }

  function toBase64url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64url(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Некорректный код ссылки');
    const s = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(s + '='.repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  async function transform(bytes, stream) {
    const writer = stream.writable.getWriter();
    const result = new Response(stream.readable).arrayBuffer();
    await writer.write(bytes);
    await writer.close();
    return new Uint8Array(await result);
  }

  async function encode(source) {
    const bytes = encoder.encode(canonical(source));
    if (bytes.length > 16000) throw new Error('Конфигурация слишком большая');
    let token = 'u' + toBase64url(bytes);
    if (typeof CompressionStream === 'function') {
      try {
        const compressed = await transform(bytes, new CompressionStream('deflate'));
        const candidate = 'z' + toBase64url(compressed);
        if (candidate.length < token.length) token = candidate;
      } catch (_) { /* Несжатая ссылка тоже работает. */ }
    }
    if (token.length > MAX_URL_PAYLOAD) throw new Error('Ссылка слишком длинная');
    return token;
  }

  async function decode(token) {
    if (typeof token !== 'string' || token.length < 2 || token.length > MAX_URL_PAYLOAD) {
      throw new Error('Некорректная длина ссылки');
    }
    const mode = token[0];
    let bytes = fromBase64url(token.slice(1));
    if (mode === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('Браузер не поддерживает сжатые ссылки');
      bytes = await transform(bytes, new DecompressionStream('deflate'));
    } else if (mode !== 'u') throw new Error('Неизвестный формат ссылки');
    if (bytes.length > 16000) throw new Error('Конфигурация слишком большая');
    return fromCompact(JSON.parse(decoder.decode(bytes)));
  }

  // FNV-1a 64: стабильный локальный идентификатор, не криптографическая подпись.
  function getConfigHash(source) {
    const bytes = encoder.encode(canonical(source));
    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  }

  function getUrlToken() {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    return params.get('config');
  }

  return { normalize, encode, decode, getConfigHash, getUrlToken };
})();
