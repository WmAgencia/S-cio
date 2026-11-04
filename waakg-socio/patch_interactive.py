#!/usr/bin/env python3
"""Private Sócio bridge: permit only HMAC-signed native quick-reply messages.

This extension is applied AFTER patch_readonly.py. The gateway stays private,
native bot stays off, broadcast/media routes remain blocked by sendMessage.
"""
from pathlib import Path
p=Path("/app/src/app/api/messages/[sessionId]/[jid]/interactive/route.ts")
s=p.read_text()
anchor='import { ChatService } from "@/modules/whatsapp/chat.service";'
assert s.count(anchor)==1, "Upstream interactive import changed"
s=s.replace(anchor,anchor+'''
import { socioOutboundContext } from "@/lib/socio-outbound-context";
import { createHmac, timingSafeEqual } from "node:crypto";
''')
anchor='        const body = await request.json();'
assert s.count(anchor)==1, "Upstream interactive request parsing changed"
s=s.replace(anchor,anchor+'''
        const timestamp = request.headers.get("x-socio-outbound-at") || "";
        const signature = request.headers.get("x-socio-outbound-signature") || "";
        const secret = process.env.WA_AKG_API_KEY || "";
        const ts = Number(timestamp);
        const allowedKeys = ["type","title","body","footer","buttons","imageBase64"];
        const shape = body && typeof body === "object" && !Array.isArray(body) &&
            Object.keys(body).every(k => allowedKeys.includes(k));
        const kind = body?.type === "buttons" || body?.type === "product";
        const textValid = typeof body?.body === "string" && body.body.trim().length > 0 &&
            body.body.length <= 900 && typeof body?.title === "string" && body.title.length <= 90 &&
            typeof body?.footer === "string" && body.footer.length <= 90;
        const btns = body?.buttons;
        const buttonsValid = Array.isArray(btns) && btns.length > 0 && btns.length <= 3 &&
            btns.every((b:any) => b && typeof b === "object" &&
                Object.keys(b).every((k:string) => ["type","displayText","id"].includes(k)) &&
                b.type === "quick_reply" && typeof b.displayText === "string" &&
                b.displayText.trim().length > 0 && b.displayText.length <= 24 &&
                typeof b.id === "string" && /^[a-zA-Z0-9:_.-]{1,96}$/.test(b.id));
        const unique = buttonsValid && new Set(btns.map((b:any) => b.id)).size === btns.length;
        const encoded = body?.imageBase64;
        const encodedValid = typeof encoded === "string" && encoded.length >= 24 &&
            encoded.length <= 3350000 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
        const imageShape = body?.type === "product" ? encodedValid : encoded === undefined;
        const privateRecipient = /^\\d{5,24}@s\\.whatsapp\\.net$/.test(jid);
        const fresh = /^\\d{13}$/.test(timestamp) && Number.isFinite(ts) &&
            Math.abs(Date.now()-ts) <= 90000;
        let signed = false;
        if(shape && kind && textValid && unique && imageShape && privateRecipient && fresh &&
            secret.length >= 20 && /^[0-9a-f]{64}$/i.test(signature)) {
            const expected = createHmac("sha256", secret)
                .update([timestamp,sessionId,jid,JSON.stringify(body)].join("\\n")).digest();
            const actual = Buffer.from(signature,"hex");
            signed = actual.length === expected.length && timingSafeEqual(expected,actual);
        }
        if(!signed) {
            return NextResponse.json({status:false,message:"Sócio interactive authorization required"},{status:403});
        }
        const photo = body.type === "product" ? Buffer.from(body.imageBase64,"base64") : undefined;
        if(body.type === "product" && (!photo || photo.length < 16 ||
           photo.length > 2500000 || photo[0] !== 255 || photo[1] !== 216 ||
           photo[photo.length-2] !== 255 || photo[photo.length-1] !== 217)) {
            return NextResponse.json({status:false,message:"Invalid JPEG product media"},{status:422});
        }
''')
anchor='            nativeFlowMessage\n        };'
assert s.count(anchor)==1, "Upstream interactive payload changed"
s=s.replace(anchor,'            nativeFlowMessage,\n            image: photo\n        };')
anchor='        const sendResult = await ChatService.sendInteractiveMessage(sessionId, jid, payload);'
assert s.count(anchor)==1, "Upstream interactive dispatch changed"
s=s.replace(anchor,'''        const sendResult = await socioOutboundContext.run(true,
            () => ChatService.sendInteractiveMessage(sessionId, jid, payload));''')
p.write_text(s)
print("Sócio WA-AKG interactive route hardened, native quick replies + catalog JPEG signed only")
