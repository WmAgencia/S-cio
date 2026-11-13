import test from 'node:test';
import assert from 'node:assert/strict';
import {isCampaignCreationRequest,isCampaignBriefDetails,wantsCampaignOrder} from '../socio-campaign-brief.mjs';

test('orders to build a campaign are recognised even when the brief also mentions results',()=>{
 for(const message of [
  'Crie uma campanha na Meta para vender roupas femininas em Sorocaba, R$ 20 por dia, e melhorar o desempenho',
  'Quero uma campanha para vender roupas em Sorocaba com R$ 20 por dia',
  'Quero que você faça uma campanha pra esse anúncio aqui',
  'Faça uma campanha pra divulgar minhas roupas',
  'Crie uma campanha para WhatsApp',
  'Quero anunciar meus produtos em São Paulo',
  'Quero vender direto pro meu WhatsApp esse sistema aqui',
  'Eu quero vender esse sistema aqui, já tenho o site, posso te mandar o link'
 ]) assert.equal(wantsCampaignOrder(message),true,message);
});

test('a detailed brief without a verb is still a build order',()=>{
 assert.equal(isCampaignBriefDetails('Campanha de roupas femininas em Sorocaba, R$ 20 por dia'),true);
 assert.equal(isCampaignBriefDetails('Anúncio para a loja, R$ 15 por dia'),true);
 assert.equal(wantsCampaignOrder('Campanha de roupas femininas em Sorocaba, R$ 20 por dia'),true);
});

test('questions, reports and optimisations about campaigns stay read-only',()=>{
 for(const message of [
  'Quero melhorar os resultados das minhas campanhas',
  'Me mostra relatório de vendas no WhatsApp',
  'Como eu crio uma campanha no gerenciador?',
  'Quero saber como estão as campanhas',
  'Quantas campanhas ativas eu tenho?',
  'Me faça um resumo das minhas campanhas do MetaEdge',
  'Análise meus anúncios',
  'Otimize minhas campanhas Meta Ads',
  'Pause a campanha 120210000001',
  'Quero aumentar o orçamento da campanha 120210000001',
  'Meus anúncios no site não vendem',
  'Quero anúncios em geral',
  'Quero vender mais',
  'Quero saber como vender pelo site'
 ]) assert.equal(wantsCampaignOrder(message),false,message);
});

test('other platforms and tracking skills are never captured by the campaign brief',()=>{
 for(const message of [
  'Crie uma campanha no Google Ads para roupas',
  'Criar pixel no WhatsApp',
  'Quero instalar CAPI para rastrear compras'
 ]) assert.equal(wantsCampaignOrder(message),false,message);
 assert.equal(isCampaignCreationRequest('Quero vender mais com a campanha'),true);
});
