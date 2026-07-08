import { createHmac } from "node:crypto";

export function createJwtTestTokens(context) {
  const now = Math.floor(Date.now() / 1000);
  return {
    correct: signJwt(context, {
      sub: context.subject,
      iss: context.issuer,
      aud: context.audience,
      exp: now + 120,
    }),
    wrongSignature: signJwt(
      context,
      {
        sub: context.subject,
        iss: context.issuer,
        aud: context.audience,
        exp: now + 120,
      },
      "wrong-secret",
    ),
    expired: signJwt(context, {
      sub: context.subject,
      iss: context.issuer,
      aud: context.audience,
      exp: now - 60,
    }),
    wrongAudience: signJwt(context, {
      sub: context.subject,
      iss: context.issuer,
      aud: "other-game",
      exp: now + 120,
    }),
    emptySubject: signJwt(context, {
      sub: " ",
      iss: context.issuer,
      aud: context.audience,
      exp: now + 120,
    }),
  };
}

function signJwt(context, payload, key = context.secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", key).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}
