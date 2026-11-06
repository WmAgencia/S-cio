// Shared commercial methodology, intentionally free of tenant data.
// Adapted from Prospector's global sales methodology; never grants outbound permissions.
import {readFileSync} from 'node:fs';
const guide=readFileSync(new URL('./socio-vendas-global.md',import.meta.url),'utf8');
export const SALES_GUIDE_VERSION='1.0';
export function socioGlobalSalesGuide(){return guide;}
export function socioCompactSalesGuide(){
 const headings=['## Conversa','## Intenções comerciais','## Atendimento de clientes existentes','## Segurança e dados'];
 return guide.split(/(?=^## )/m).filter(section=>headings.some(h=>section.startsWith(h))).join('\n').slice(0,5200);
}
