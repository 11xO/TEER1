export const phone = '01111111111';
export const area = 'المنطقة الأولى';
export const user = { name: 'أحمد', phone, area, address: 'شارع النور، عمارة ١' };
export function fixtureData() {
  return { primary: {
    areas: { a: { name: area }, b: { name: 'المنطقة الثانية' } },
    settings: { [area]: { shippingPrice: 30, shippingDays: 3 }, 'المنطقة الثانية': {}, support: { whatsapp: '01115699940' }, social: {}, work_hours: { enabled: false } },
    pricing: { [area]: { generalDeliveryPrice: 25, delegateCommission: 10, tuktukCommission: 10, destinations: { d1: { name: 'المحطة', price: 15 } } } },
    reward_settings: { [area]: { active: true, discountCost: 100, tripDiscountCost: 50, directDiscountValue: 20, pointsPerOrder: 10, fakkaCost: 150, fakka_cards_vodafone: { c1: { code: '12345678912345' } } } },
    users_points: { [phone]: 500 },
    market_categories: { [area]: { c1: { name: 'بقالة', icon: '🥫' } } },
    market_products: { [area]: { p1: { name: 'أرز', price: 50, categoryId: 'c1' }, p2: { name: 'سكر', price: 30, categoryId: 'c1' } } },
    my_invite_codes: { [phone]: 'TEER1111' }, invite_codes: { TEER1111: phone },
    orders: {},
  }, secondary: { customers: { [phone]: user }, approved_users: { [phone]: user } } };
}
const mockSource = `
const data = window.__testData;
const listeners = new Set();
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
function at(path, database='primary') { return path.split('/').filter(Boolean).reduce((value,key)=>value?.[key],data[database]) ?? null; }
function put(path,value,database='primary') {
  const keys=path.split('/').filter(Boolean); const last=keys.pop();
  let node=data[database]; for(const key of keys) node=node[key] ||= {};
  if(value && typeof value==='object' && value.__increment !== undefined) value=Number(node[last]||0)+value.__increment;
  if(value===null) delete node[last]; else node[last]=clone(value);
}
function notify(paths,database='primary') {
  for(const listener of listeners) if(listener.database===database && paths.some(path=>path===listener.path || path.startsWith(listener.path+'/') || listener.path.startsWith(path+'/'))) queueMicrotask(()=>listeners.has(listener)&&listener.callback(clone(at(listener.path,database))));
}
export const increment = value => ({__increment:value});
export const databaseRef = path => ({path});
export const newKey = () => 'test-'+(++window.__testId);
export const read = async (path,database='primary') => {if(window.__delayProfileRead && database==='secondary' && path.startsWith('approved_users/'))return new Promise(resolve=>{window.__releaseProfileRead=()=>resolve(clone(at(path,database)));});return clone(at(path,database));};
export async function write(path,value,database='primary') { put(path,value,database); notify([path],database); }
export async function patch(path,values,database='primary') {
  if(window.__failOrder && Object.keys(values).some(key=>key.startsWith('orders/'))) throw Error('simulated offline write');
  const paths=[]; for(const [key,value] of Object.entries(values)) { const full=[path==='/'?'':path,key].filter(Boolean).join('/'); put(full,value,database); paths.push(full); } notify(paths,database);
}
export const create = async (path,value,database='primary') => {if(window.__failRegistration && path==='pending_registrations')throw Error('Registration temporarily unavailable');const id=newKey();await write(path+'/'+id,value,database);return id;};
export async function transaction(path,fn,database='primary') {
  const value=fn(clone(at(path,database))); const committed=value!==undefined;
  if(committed) await write(path,value,database);
  return {committed,snapshot:{val:()=>clone(committed?value:at(path,database))}};
}
export const watch = (path,callback,_error,database='primary') => {const listener={path,callback,database};listeners.add(listener);queueMicrotask(()=>listeners.has(listener)&&callback(clone(at(path,database))));return()=>listeners.delete(listener);};
export const findByPhone=async(path,phone)=>Object.fromEntries(Object.entries(at(path)||{}).filter(([,value])=>value.phone===phone));
export const saveProfile=async(phone,changes)=>{for(const database of ['primary','secondary']) for(const collection of ['customers','approved_users']) await patch(collection+'/'+phone,changes,database);};
window.__fixture={write,patch,data};
`;
export async function setup(page, { loggedIn = true, discounts, data = fixtureData(), url = '/', apiHandler } = {}) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/src/api/firebase.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: mockSource });
    return route.continue();
  });
  if (apiHandler) await page.route((url) => url.pathname.startsWith('/api/'), apiHandler);
  await page.routeWebSocket('**/api/events', (socket) => { socket.send(JSON.stringify({ type: 'session.updated' })); });
  await page.addInitScript(({ data, loggedIn, discounts, user }) => {
    window.__testData = data; window.__testId = 0;
    if (!sessionStorage.getItem('fixture-initialized')) {
      localStorage.clear(); sessionStorage.setItem('fixture-initialized', 'true');
      if (loggedIn) for (const [key, value] of Object.entries(user)) localStorage.setItem('user_' + key, value);
      if (discounts) localStorage.setItem('teer_discounts:' + user.phone, JSON.stringify(discounts));
    }
  }, { data, loggedIn, discounts, user });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.splash').waitFor({ state: 'detached' });
}
