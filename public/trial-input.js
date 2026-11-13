// Shared CPF/CNPJ input helpers. Loaded as a classic script so app.js can use
// them synchronously; also importable from Node tests (it only touches globalThis).
(function(root){
 function taxIdDigits(value){return String(value??'').replace(/\D/g,'');}
 function cpfIsValid(value){
  const c=taxIdDigits(value);
  if(!/^\d{11}$/.test(c)||/^(.)\1{10}$/.test(c))return false;
  const digit=n=>{let sum=0;for(let i=0;i<n;i++)sum+=Number(c[i])*(n+1-i);const mod=(sum*10)%11;return mod===10?0:mod;};
  return digit(9)===Number(c[9])&&digit(10)===Number(c[10]);
 }
 root.SocioTrialInput=Object.freeze({taxIdDigits,cpfIsValid});
})(globalThis);
