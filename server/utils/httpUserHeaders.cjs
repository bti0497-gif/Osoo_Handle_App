'use strict';

/**
 * Fetch/釉뚮씪?곗???Request ?ㅻ뜑 媛믪쓣 ISO-8859-1濡쒕쭔 ?덉슜?쒕떎.
 * ?대씪?댁뼵?몃뒗 encodeURIComponent濡??섍린怨? ?쒕쾭?먯꽌 ???⑥닔濡?蹂듭썝?쒕떎.
 * ?덉쟾(誘몄씤肄붾뵫) 媛믪? URIError ???먮Ц??洹몃?濡??대떎.
 */
function decodeUserContextHeader(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

module.exports = { decodeUserContextHeader };
