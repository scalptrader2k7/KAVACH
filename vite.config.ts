import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// External access is a deliberate exception, not the development default.
const cliHostIndex=process.argv.indexOf('--host');
const cliHost=process.argv.find(a=>a.startsWith('--host='))?.split('=')[1]
  ?? (cliHostIndex>=0 ? (process.argv[cliHostIndex+1]?.startsWith('-') ? '0.0.0.0' : process.argv[cliHostIndex+1]||'0.0.0.0') : undefined);
const host=cliHost??process.env.KAVACH_HOST??'127.0.0.1';
const external=process.env.KAVACH_ALLOW_EXTERNAL==='1';
if(!['localhost','127.0.0.1','::1'].includes(host)) {
  if(!external)throw new Error('External binding requires KAVACH_ALLOW_EXTERNAL=1. The privileged fixture issuer and exported evidence must not be exposed publicly.');
  console.warn('WARNING: trusted isolated demo only. Privileged signing endpoints and evidence have no public-user authorization.');
}
const extras=external?(process.env.KAVACH_ALLOWED_HOSTS??'').split(',').map(h=>h.trim()).filter(Boolean):[];
if(extras.some(h=>h.includes('*')||h.startsWith('.')||h.includes('/')||h.includes(':')))throw new Error('KAVACH_ALLOWED_HOSTS requires exact hostnames, not wildcard domains, ports, or URLs.');
const allowedHosts=['localhost','127.0.0.1',...extras];
export default defineConfig({
  root:'web',plugins:[react()],
  server:{host,allowedHosts,proxy:{'/api':{target:'http://127.0.0.1:8000',changeOrigin:true}}},
  preview:{host,allowedHosts},
  build:{outDir:'../dist',emptyOutDir:true},
});
