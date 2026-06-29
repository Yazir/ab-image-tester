const BASE = '/api';
async function request(url, options) {
    const res = await fetch(BASE + url, options);
    if (!res.ok) {
        let errMsg = `Request failed (${res.status})`;
        try {
            const data = await res.json();
            errMsg = data.error || errMsg;
        }
        catch { }
        throw new Error(errMsg);
    }
    const data = await res.json();
    return data;
}
export function api(url, init) {
    return request(url, init);
}
let _maxFileSize = 10 * 1024 * 1024;
let _maxImages = 50;
export let adminKeyRequired = false;
export function maxFileSize() {
    return _maxFileSize;
}
export function maxImages() {
    return _maxImages;
}
export async function loadConfig() {
    try {
        const cfg = await api('/polls/config');
        _maxFileSize = cfg.maxFileSize;
        _maxImages = cfg.maxImages;
        adminKeyRequired = cfg.adminKeyRequired;
    }
    catch { }
}
export function authHeaders(token) {
    return { 'x-admin-token': token };
}
export function adminKeyHeaders(key) {
    return { 'x-admin-key': key };
}
function randomUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
function getFingerprint() {
    let fp = localStorage.getItem('voterFingerprint');
    if (!fp) {
        fp = randomUUID();
        localStorage.setItem('voterFingerprint', fp);
    }
    return fp;
}
function getVoterToken() {
    return sessionStorage.getItem('voterToken');
}
function setVoterToken(token) {
    sessionStorage.setItem('voterToken', token);
}
export function voterHeaders() {
    const fp = getFingerprint();
    const token = getVoterToken();
    const headers = { 'x-voter-fingerprint': fp };
    if (token)
        headers['x-voter-token'] = token;
    return headers;
}
export function storeVoterToken(token) {
    setVoterToken(token);
}
