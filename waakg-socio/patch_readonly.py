#!/usr/bin/env python3
"""Keep Sócio gateway native bot and all non-authorized sending disabled.

Allow ONLY authenticated, HMAC-signed sends through the upstream
/api/messages/{sessionId}/{jid}/send route, addressed to one private chat or
one group, carrying either plain text or one image/video whose URL is served
by Sócio itself. Broadcasts, mentions, quotes, documents and direct socket
APIs remain read-only. Pin exact anchors.
"""
from pathlib import Path

p=Path("/app/src/modules/whatsapp/manager.ts")
s=p.read_text()
old='                        enabled: true,'
assert s.count(old)==1, "WA-AKG bot default changed"
p.write_text(s.replace(old,'                        enabled: false,'))

Path("/app/src/lib/socio-outbound-context.ts").write_text(
'''import { AsyncLocalStorage } from "node:async_hooks";
// Only the verified /send request can enter this async context.
// Never set a process-wide boolean: concurrent requests must not share it.
export const socioOutboundContext = new AsyncLocalStorage<boolean>();
''')

p=Path("/app/src/modules/whatsapp/instance.ts")
s=p.read_text()
anchor='import { antispam } from "./antispam";'
assert s.count(anchor)==1, "WA-AKG antispam import changed"
s=s.replace(anchor,anchor+'\nimport { socioOutboundContext } from "@/lib/socio-outbound-context";')
anchor='                bindAutoReply(this.socket as WASocket, this.sessionId);'
assert s.count(anchor)==1, "WA-AKG autoreply hook changed"
s=s.replace(anchor,'''                // Sócio never allows the gateway-native bot.
                if (process.env.SOCIO_GATEWAY_READ_ONLY !== "true") {
                    bindAutoReply(this.socket as WASocket, this.sessionId);
                }''')
anchor='        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {'
assert s.count(anchor)==1, "WA-AKG send wrapper changed"
s=s.replace(anchor,'''        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {
            // Fail closed for all gateway API endpoints other than an
            // authenticated and signed single-recipient text request.
            if (process.env.SOCIO_GATEWAY_READ_ONLY === "true" &&
                !socioOutboundContext.getStore()) {
                throw new Error("SOCIO_GATEWAY_READ_ONLY: outbound requires approved Sócio context");
            }
''')
p.write_text(s)

p=Path("/app/src/app/api/messages/[sessionId]/[jid]/send/route.ts")
s=p.read_text()
anchor='import { ChatService } from "@/modules/whatsapp/chat.service";'
assert s.count(anchor)==1, "WA-AKG send route import changed"
s=s.replace(anchor,anchor+'''
import { socioOutboundContext } from "@/lib/socio-outbound-context";
import { createHmac, timingSafeEqual } from "node:crypto";''')
anchor='        const { message, mentions, quotedMessageId } = body;'
assert s.count(anchor)==1, "WA-AKG send route payload changed"
s=s.replace(anchor,anchor+'''
        // Sócio does not expose generic media/mentions/broadcast APIs.
        // Both services share the private gateway API key; signed data
        // includes the recipient and message to prevent cross-request reuse.
        const timestamp = request.headers.get("x-socio-outbound-at") || "";
        const signature = request.headers.get("x-socio-outbound-signature") || "";
        const secret = process.env.WA_AKG_API_KEY || "";
        const publicOrigin = (process.env.SOCIO_PUBLIC_URL || "").replace(/\\/+$/, "");
        const when = Number(timestamp);
        const keys = message && typeof message === "object" && !Array.isArray(message)
            ? Object.keys(message) : [];
        const plainText = typeof message?.text === "string" ? message.text.trim() : "";
        const approvedText = plainText.length > 0 && plainText.length <= 3000 &&
            keys.length === 1 && keys[0] === "text" && !mentions && !quotedMessageId;
        const mediaKind = keys.length === 1 && (keys[0] === "image" || keys[0] === "video")
            ? keys[0] : "";
        const media = mediaKind ? message[mediaKind] : null;
        const mediaKeys = media && typeof media === "object" && !Array.isArray(media)
            ? Object.keys(media) : [];
        const caption = typeof media?.caption === "string" ? media.caption.trim() : "";
        // Media must be served by Sócio: never fetch an arbitrary host here.
        const approvedMedia = Boolean(mediaKind) && !mentions && !quotedMessageId &&
            mediaKeys.includes("url") &&
            mediaKeys.every((k: string) => k === "url" || k === "caption") &&
            typeof media?.url === "string" && publicOrigin.length >= 12 &&
            media.url.startsWith(publicOrigin + "/") && media.url.length <= 1800 &&
            caption.length <= 1024;
        const privateRecipient = /^\\d{5,24}@s\\.whatsapp\\.net$/.test(jid);
        const groupRecipient = /^\\d{5,24}(-\\d{5,24})?@g\\.us$/.test(jid);
        const recipient = privateRecipient || groupRecipient;
        const canonical = approvedText ? "text:" + plainText
            : approvedMedia ? mediaKind + ":" + media.url + ":" + caption : "";
        const fresh = /^\\d{13}$/.test(timestamp) && Number.isFinite(when) &&
            Math.abs(Date.now() - when) <= 90000;
        let verified = false;
        if (canonical && recipient && fresh && secret.length >= 20 &&
            /^[0-9a-f]{64}$/i.test(signature)) {
            const actual = Buffer.from(signature, "hex");
            if (actual.length === 64) {
                const v2 = createHmac("sha256", secret)
                    .update([timestamp, sessionId, jid, canonical].join("\\n")).digest();
                // v1 accepted only for private text, so older clients keep working.
                const v1 = approvedText && privateRecipient
                    ? createHmac("sha256", secret)
                        .update([timestamp, sessionId, jid, plainText].join("\\n")).digest()
                    : null;
                verified = timingSafeEqual(v2, actual) || (v1 !== null && timingSafeEqual(v1, actual));
            }
        }
        if (!verified) {
            return NextResponse.json({ status: false, message: "Sócio send authorization required" }, { status: 403 });
        }
''')
anchor='        const result = await ChatService.sendTextMessage(sessionId, jid, message, mentions, quotedMessageId);'
assert s.count(anchor)==1, "WA-AKG send route handler changed"
s=s.replace(anchor,'''        const result = await socioOutboundContext.run(true,
            () => ChatService.sendTextMessage(sessionId, jid, message, undefined, undefined));''')
p.write_text(s)

p=Path("/app/src/app/api/sessions/[sessionId]/bot-config/route.ts")
s=p.read_text()
old='            update: {\n                botMode: body.botMode,'
assert s.count(old)==1, "WA-AKG config update anchor changed"
s=s.replace(old,'            update: {\n                enabled: false,\n                botMode: body.botMode,')
old='                enabled: body.enabled ?? true,'
assert s.count(old)==1, "WA-AKG config default changed"
s=s.replace(old,'                enabled: false,')
p.write_text(s)
print("Sócio gateway: native bot off, only HMAC-approved text/media to one private chat or group")
