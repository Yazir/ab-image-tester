const BASE = '/api';
async function request(url, options) {
    const res = await fetch(BASE + url, options);
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || 'Request failed');
    return data;
}
export function api(url, init) {
    return request(url, init);
}
export function authHeaders(token) {
    return { 'x-admin-token': token };
}
function getFingerprint() {
    let fp = localStorage.getItem('voterFingerprint');
    if (!fp) {
        fp = crypto.randomUUID();
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
