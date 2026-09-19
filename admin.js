// ============================================================
// PANEL DE ADMINISTRACIÓN — CIAO Pizzería
// Requiere supabase-config.js cargado antes que este archivo.
// ============================================================

const ESTADOS = ['Nuevo', 'Preparando', 'En camino', 'Entregado', 'Cancelado'];
const SIGUIENTE_ESTADO = {
  'Nuevo': 'Preparando',
  'Preparando': 'En camino',
  'En camino': 'Entregado',
};
const STATUS_CLASS = {
  'Nuevo': 'badge-Nuevo',
  'Preparando': 'badge-Preparando',
  'En camino': 'badge-EnCamino',
  'Entregado': 'badge-Entregado',
  'Cancelado': 'badge-Cancelado',
};

let pedidosCache = [];
let filtroEstado = 'Todos';
let filtroTexto = '';
let realtimeChannel = null;

// ---------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------
const loginScreen = document.getElementById('loginScreen');
const adminApp = document.getElementById('adminApp');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

async function checkSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    mostrarPanel();
  } else {
    mostrarLogin();
  }
}

function mostrarLogin() {
  loginScreen.classList.remove('hidden');
  adminApp.classList.add('hidden');
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (realtimeChannelInventario) {
    supabaseClient.removeChannel(realtimeChannelInventario);
    realtimeChannelInventario = null;
  }
  inventarioCargadoUnaVez = false;
}

function mostrarPanel() {
  loginScreen.classList.add('hidden');
  adminApp.classList.remove('hidden');
  cargarPedidos();
  suscribirseATiempoReal();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = 'Correo o contraseña incorrectos.';
    loginError.classList.remove('hidden');
    return;
  }
  mostrarPanel();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  mostrarLogin();
});

// ---------------------------------------------------------------
// CARGA DE PEDIDOS
// ---------------------------------------------------------------
async function cargarPedidos() {
  const loadingEl = document.getElementById('ordersLoading');
  loadingEl.classList.remove('hidden');

  const { data, error } = await supabaseClient
    .from('pedidos')
    .select('*')
    .order('creado_en', { ascending: false });

  loadingEl.classList.add('hidden');

  if (error) {
    console.error('Error cargando pedidos:', error.message);
    return;
  }
  pedidosCache = data || [];
  renderTodo();
}

function suscribirseATiempoReal() {
  if (realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel('pedidos-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
      cargarPedidos();
    })
    .subscribe();
}

// ---------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------
function esHoy(fechaISO) {
  const fecha = new Date(fechaISO);
  const hoy = new Date();
  return fecha.getFullYear() === hoy.getFullYear() &&
         fecha.getMonth() === hoy.getMonth() &&
         fecha.getDate() === hoy.getDate();
}

function formatearHora(fechaISO) {
  const fecha = new Date(fechaISO);
  const horaStr = fecha.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  if (esHoy(fechaISO)) return horaStr;
  const fechaStr = fecha.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' });
  return `${fechaStr} ${horaStr}`;
}

function resumenProductos(items) {
  if (!items || !items.length) return '—';
  return items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ');
}

function textoBusquedaPedido(pedido) {
  const items = (pedido.items || []).map(it => it.nombre).join(' ');
  return `${pedido.id} ${pedido.cliente_nombre} ${pedido.cliente_telefono} ${items}`.toLowerCase();
}

// ---------------------------------------------------------------
// RENDER: MÉTRICAS
// ---------------------------------------------------------------
function renderKpis() {
  const reales = pedidosCache.filter(p => !p.es_prueba);
  const deHoy = reales.filter(p => esHoy(p.creado_en));

  const pendientes = reales.filter(p => p.estado === 'Nuevo' || p.estado === 'Preparando').length;
  const enCamino = reales.filter(p => p.estado === 'En camino').length;
  const ventasHoy = deHoy
    .filter(p => p.estado !== 'Cancelado')
    .reduce((sum, p) => sum + Number(p.total || 0), 0);

  document.getElementById('kpiHoy').textContent = deHoy.length;
  document.getElementById('kpiPendientes').textContent = pendientes;
  document.getElementById('kpiCamino').textContent = enCamino;
  document.getElementById('kpiVentas').textContent = `$${ventasHoy.toFixed(2)}`;
}

// ---------------------------------------------------------------
// RENDER: TABLA
// ---------------------------------------------------------------
function pedidosFiltrados() {
  return pedidosCache.filter(p => {
    if (filtroEstado !== 'Todos' && p.estado !== filtroEstado) return false;
    if (filtroTexto && !textoBusquedaPedido(p).includes(filtroTexto)) return false;
    return true;
  });
}

function renderTabla() {
  const tbody = document.getElementById('ordersBody');
  const emptyEl = document.getElementById('ordersEmpty');
  const lista = pedidosFiltrados();

  if (!lista.length) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = lista.map(p => {
    const siguiente = SIGUIENTE_ESTADO[p.estado];
    const botonHTML = siguiente
      ? `<button class="advance-btn" data-id="${p.id}" data-siguiente="${siguiente}" type="button">Marcar "${siguiente}"</button>`
      : `<button class="advance-btn" disabled type="button">—</button>`;

    return `
      <tr class="order-row ${p.es_prueba ? 'es-prueba' : ''}" data-id="${p.id}">
        <td class="order-id">#${p.id}${p.es_prueba ? '<span class="prueba-badge">PRUEBA</span>' : ''}</td>
        <td class="order-hora">${formatearHora(p.creado_en)}</td>
        <td>
          <div class="order-cliente-nombre">${escapeHTML(p.cliente_nombre)}</div>
          <div class="order-cliente-tel">${escapeHTML(p.cliente_telefono)}</div>
        </td>
        <td class="order-productos">${escapeHTML(resumenProductos(p.items))}</td>
        <td class="order-total">$${Number(p.total || 0).toFixed(2)}</td>
        <td><span class="badge ${STATUS_CLASS[p.estado] || ''}">${p.estado}</span></td>
        <td>${botonHTML}</td>
      </tr>
    `;
  }).join('');
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTodo() {
  renderKpis();
  renderTabla();
}

// ---------------------------------------------------------------
// EVENTOS: BÚSQUEDA Y FILTROS
// ---------------------------------------------------------------
document.getElementById('searchInput').addEventListener('input', (e) => {
  filtroTexto = e.target.value.trim().toLowerCase();
  renderTabla();
});

document.getElementById('statusTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.status-tab');
  if (!btn) return;
  document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  filtroEstado = btn.dataset.status;
  renderTabla();
});

// ---------------------------------------------------------------
// EVENTOS: AVANZAR ESTADO / ABRIR DETALLE
// ---------------------------------------------------------------
document.getElementById('ordersBody').addEventListener('click', async (e) => {
  const advanceBtn = e.target.closest('.advance-btn');
  if (advanceBtn && !advanceBtn.disabled) {
    e.stopPropagation();
    const id = advanceBtn.dataset.id;
    const siguiente = advanceBtn.dataset.siguiente;
    await actualizarEstado(id, siguiente);
    return;
  }
  const row = e.target.closest('.order-row');
  if (row) {
    abrirDetalle(row.dataset.id);
  }
});

async function actualizarEstado(id, nuevoEstado) {
  const { error } = await supabaseClient
    .from('pedidos')
    .update({ estado: nuevoEstado })
    .eq('id', id);
  if (error) {
    alert('No se pudo actualizar el estado: ' + error.message);
    return;
  }
  // La suscripción en tiempo real recargará la tabla; por si acaso, forzamos también:
  cargarPedidos();
}

// ---------------------------------------------------------------
// MODAL DE DETALLE
// ---------------------------------------------------------------
const detailOverlay = document.getElementById('detailOverlay');
const detailBody = document.getElementById('detailBody');
const detailTitle = document.getElementById('detailTitle');

function abrirDetalle(id) {
  const pedido = pedidosCache.find(p => String(p.id) === String(id));
  if (!pedido) return;

  detailTitle.textContent = `Pedido #${pedido.id}`;

  const itemsHTML = (pedido.items || []).map(it => {
    const precioTxt = it.sin_precio ? 'Precio a confirmar' : `$${Number(it.precio || 0).toFixed(2)} c/u`;
    const extrasHTML = (it.extras || []).map(ex =>
      `<div class="detail-item-extra">+ ${escapeHTML(ex.nombre)} ($${Number(ex.precio || 0).toFixed(2)})</div>`
    ).join('');
    return `
      <div class="detail-item">
        <div class="detail-item-main">
          <span>${it.cantidad} x ${escapeHTML(it.nombre)}</span>
          <span>${precioTxt}</span>
        </div>
        ${extrasHTML}
      </div>
    `;
  }).join('');

  detailBody.innerHTML = `
    <div>
      <div class="detail-section-label">Cliente</div>
      <div class="detail-grid">
        <div><strong>Nombre:</strong> ${escapeHTML(pedido.cliente_nombre)}</div>
        <div><strong>Teléfono:</strong> ${escapeHTML(pedido.cliente_telefono)}</div>
        <div style="grid-column:1 / -1;"><strong>Dirección:</strong> ${escapeHTML(pedido.direccion)}</div>
        <div><strong>Pago:</strong> ${escapeHTML(pedido.forma_pago)}</div>
        <div><strong>Fecha:</strong> ${new Date(pedido.creado_en).toLocaleString('es-VE')}</div>
      </div>
    </div>

    <div>
      <div class="detail-section-label">Productos</div>
      <div class="detail-items">${itemsHTML || '<p>Sin productos</p>'}</div>
      <div class="detail-total-row"><span>Total</span><span>$${Number(pedido.total || 0).toFixed(2)}</span></div>
    </div>

    ${pedido.notas ? `
    <div>
      <div class="detail-section-label">Notas</div>
      <p>${escapeHTML(pedido.notas)}</p>
    </div>` : ''}

    <div>
      <div class="detail-section-label">Estado del pedido</div>
      <div class="detail-status-row">
        <select class="status-select" id="detailStatusSelect">
          ${ESTADOS.map(s => `<option value="${s}" ${s === pedido.estado ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  document.getElementById('detailStatusSelect').addEventListener('change', async (e) => {
    await actualizarEstado(pedido.id, e.target.value);
  });

  detailOverlay.classList.add('open');
}

document.getElementById('detailClose').addEventListener('click', () => {
  detailOverlay.classList.remove('open');
});
detailOverlay.addEventListener('click', (e) => {
  if (e.target === detailOverlay) detailOverlay.classList.remove('open');
});

// ---------------------------------------------------------------
// PEDIDO DE PRUEBA
// ---------------------------------------------------------------
document.getElementById('testOrderBtn').addEventListener('click', async () => {
  const pedidoPrueba = {
    cliente_nombre: 'Cliente de Prueba',
    cliente_telefono: '0426-0000000',
    direccion: 'Sector de prueba, casa de ejemplo, Elorza',
    forma_pago: 'Pago móvil',
    notas: 'Este es un pedido de prueba generado desde el panel.',
    items: [
      { nombre: 'Pizza Pepperoni (Mediana)', cantidad: 1, precio: 9.48, sin_precio: false, extras: [] },
      { nombre: 'Refrescos 400 ml', cantidad: 1, precio: null, sin_precio: true, extras: [] },
    ],
    total: 9.48,
    estado: 'Nuevo',
    es_prueba: true,
  };
  const { error } = await supabaseClient.from('pedidos').insert(pedidoPrueba);
  if (error) {
    alert('No se pudo crear el pedido de prueba: ' + error.message);
  }
});

// ---------------------------------------------------------------
// EXPORTAR CSV
// ---------------------------------------------------------------
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  if (!pedidosCache.length) {
    alert('No hay pedidos para exportar todavía.');
    return;
  }

  const encabezados = ['ID', 'Fecha', 'Cliente', 'Teléfono', 'Dirección', 'Productos', 'Pago', 'Notas', 'Total', 'Estado', 'Es prueba'];
  const filas = pedidosCache.map(p => [
    p.id,
    new Date(p.creado_en).toLocaleString('es-VE'),
    p.cliente_nombre,
    p.cliente_telefono,
    p.direccion,
    resumenProductos(p.items),
    p.forma_pago,
    p.notas || '',
    Number(p.total || 0).toFixed(2),
    p.estado,
    p.es_prueba ? 'Sí' : 'No',
  ]);

  const csvEscape = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvContent = [encabezados, ...filas]
    .map(fila => fila.map(csvEscape).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fechaArchivo = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `pedidos_ciao_pizzeria_${fechaArchivo}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------
// NAVEGACIÓN ENTRE VISTAS (Pedidos / Inventario / Caja)
// ---------------------------------------------------------------
const viewPedidos = document.getElementById('viewPedidos');
const viewInventario = document.getElementById('viewInventario');
const viewCaja = document.getElementById('viewCaja');
let inventarioCargadoUnaVez = false;
let cajaCargadaUnaVez = false;

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    const vista = link.dataset.view;
    viewPedidos.classList.toggle('hidden', vista !== 'pedidos');
    viewInventario.classList.toggle('hidden', vista !== 'inventario');
    viewCaja.classList.toggle('hidden', vista !== 'caja');

    if (vista === 'inventario') {
      if (!inventarioCargadoUnaVez) {
        inventarioCargadoUnaVez = true;
        suscribirseATiempoRealInventario();
      }
      cargarIngredientes();
    } else if (vista === 'caja') {
      if (!cajaCargadaUnaVez) {
        cajaCargadaUnaVez = true;
      }
      cargarCaja();
    }
  });
});

// ---------------------------------------------------------------
// INVENTARIO: ESTADO EN MEMORIA
// ---------------------------------------------------------------
let ingredientesCache = [];
let movimientosHoyCount = 0;
let filtroTextoIngrediente = '';
let ingredienteEnMovimiento = null; // { id, nombre, unidad, stock_actual } — para el modal de movimiento
let realtimeChannelInventario = null;

async function cargarIngredientes() {
  const loadingEl = document.getElementById('ingredientsLoading');
  loadingEl.classList.remove('hidden');

  const { data, error } = await supabaseClient
    .from('ingredientes')
    .select('*')
    .order('nombre', { ascending: true });

  loadingEl.classList.add('hidden');

  if (error) {
    console.error('Error cargando ingredientes:', error.message);
    return;
  }
  ingredientesCache = data || [];

  const hoy = new Date();
  const { count } = await supabaseClient
    .from('movimientos_inventario')
    .select('id', { count: 'exact', head: true })
    .gte('creado_en', new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString());
  movimientosHoyCount = count || 0;

  renderInventario();
}

function suscribirseATiempoRealInventario() {
  if (realtimeChannelInventario) return;
  realtimeChannelInventario = supabaseClient
    .channel('inventario-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredientes' }, () => cargarIngredientes())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_inventario' }, () => cargarIngredientes())
    .subscribe();
}

function ingredientesFiltrados() {
  if (!filtroTextoIngrediente) return ingredientesCache;
  return ingredientesCache.filter(i => i.nombre.toLowerCase().includes(filtroTextoIngrediente));
}

function renderInventarioKpis() {
  const bajos = ingredientesCache.filter(i => Number(i.stock_actual) <= Number(i.stock_minimo)).length;
  document.getElementById('kpiTotalIngredientes').textContent = ingredientesCache.length;
  document.getElementById('kpiStockBajo').textContent = bajos;
  document.getElementById('kpiMovimientosHoy').textContent = movimientosHoyCount;
}

function renderInventarioTabla() {
  const tbody = document.getElementById('ingredientsBody');
  const emptyEl = document.getElementById('ingredientsEmpty');
  const lista = ingredientesFiltrados();

  if (!lista.length) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = lista.map(ing => {
    const bajo = Number(ing.stock_actual) <= Number(ing.stock_minimo);
    return `
      <tr data-id="${ing.id}">
        <td><strong>${escapeHTML(ing.nombre)}</strong></td>
        <td>${escapeHTML(ing.unidad)}</td>
        <td>${Number(ing.stock_actual)}</td>
        <td>${Number(ing.stock_minimo)}</td>
        <td><span class="badge ${bajo ? 'badge-stock-bajo' : 'badge-stock-ok'}">${bajo ? 'Stock bajo' : 'Bien'}</span></td>
        <td>
          <div class="ingredient-actions">
            <button class="mini-btn entrada" data-id="${ing.id}" data-tipo="Entrada" type="button">+ Entrada</button>
            <button class="mini-btn salida" data-id="${ing.id}" data-tipo="Salida" type="button">− Salida</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderInventario() {
  renderInventarioKpis();
  renderInventarioTabla();
}

document.getElementById('ingredientSearchInput').addEventListener('input', (e) => {
  filtroTextoIngrediente = e.target.value.trim().toLowerCase();
  renderInventarioTabla();
});

// ---------------------------------------------------------------
// MODAL: NUEVO INGREDIENTE
// ---------------------------------------------------------------
const ingredientOverlay = document.getElementById('ingredientOverlay');
document.getElementById('newIngredientBtn').addEventListener('click', () => {
  document.getElementById('ingredientForm').reset();
  ingredientOverlay.classList.add('open');
});
document.getElementById('ingredientClose').addEventListener('click', () => {
  ingredientOverlay.classList.remove('open');
});
ingredientOverlay.addEventListener('click', (e) => {
  if (e.target === ingredientOverlay) ingredientOverlay.classList.remove('open');
});

document.getElementById('ingredientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('ingName').value.trim();
  const unidad = document.getElementById('ingUnidad').value;
  const stockInicial = parseFloat(document.getElementById('ingStockInicial').value) || 0;
  const stockMinimo = parseFloat(document.getElementById('ingStockMinimo').value) || 0;

  const { error } = await supabaseClient.from('ingredientes').insert({
    nombre, unidad, stock_actual: stockInicial, stock_minimo: stockMinimo,
  });
  if (error) {
    alert('No se pudo guardar el ingrediente: ' + error.message);
    return;
  }
  ingredientOverlay.classList.remove('open');
  cargarIngredientes();
});

// ---------------------------------------------------------------
// MODAL: REGISTRAR MOVIMIENTO (Entrada / Salida)
// ---------------------------------------------------------------
const movementOverlay = document.getElementById('movementOverlay');

document.getElementById('ingredientsBody').addEventListener('click', (e) => {
  const btn = e.target.closest('.mini-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  const tipo = btn.dataset.tipo;
  const ingrediente = ingredientesCache.find(i => String(i.id) === String(id));
  if (!ingrediente) return;

  ingredienteEnMovimiento = { ...ingrediente, tipo };
  document.getElementById('movementTitle').textContent =
    tipo === 'Entrada' ? 'Registrar entrada' : 'Registrar salida';
  document.getElementById('movementIngredientLabel').textContent =
    `${ingrediente.nombre} — stock actual: ${Number(ingrediente.stock_actual)} ${ingrediente.unidad}`;
  document.getElementById('movementSubmitBtn').textContent =
    tipo === 'Entrada' ? 'Registrar entrada' : 'Registrar salida';
  document.getElementById('movCantidad').value = '';
  document.getElementById('movMotivo').value = '';
  movementOverlay.classList.add('open');
});

document.getElementById('movementClose').addEventListener('click', () => {
  movementOverlay.classList.remove('open');
});
movementOverlay.addEventListener('click', (e) => {
  if (e.target === movementOverlay) movementOverlay.classList.remove('open');
});

document.getElementById('movementForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ingredienteEnMovimiento) return;

  const cantidad = parseFloat(document.getElementById('movCantidad').value);
  const motivo = document.getElementById('movMotivo').value.trim() || null;
  const { id, tipo, stock_actual } = ingredienteEnMovimiento;

  if (!cantidad || cantidad <= 0) {
    alert('Ingresa una cantidad válida, mayor que cero.');
    return;
  }
  if (tipo === 'Salida' && cantidad > Number(stock_actual)) {
    if (!confirm('La cantidad de salida es mayor al stock actual. ¿Deseas continuar de todas formas?')) {
      return;
    }
  }

  const nuevoStock = tipo === 'Entrada'
    ? Number(stock_actual) + cantidad
    : Number(stock_actual) - cantidad;

  const { error: errorMov } = await supabaseClient.from('movimientos_inventario').insert({
    ingrediente_id: id, tipo, cantidad, motivo,
  });
  if (errorMov) {
    alert('No se pudo registrar el movimiento: ' + errorMov.message);
    return;
  }

  const { error: errorUpd } = await supabaseClient
    .from('ingredientes')
    .update({ stock_actual: nuevoStock })
    .eq('id', id);
  if (errorUpd) {
    alert('El movimiento se registró, pero no se pudo actualizar el stock: ' + errorUpd.message);
  }

  movementOverlay.classList.remove('open');
  ingredienteEnMovimiento = null;
  cargarIngredientes();
});

// ---------------------------------------------------------------
// CAJA: ESTADO EN MEMORIA
// ---------------------------------------------------------------
let gastosCache = [];
let cierresCache = [];

function hoyISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

async function cargarCaja() {
  await Promise.all([cargarGastosHoy(), cargarCierres()]);
  renderCaja();
}

async function cargarGastosHoy() {
  const { data, error } = await supabaseClient
    .from('gastos')
    .select('*')
    .eq('fecha', hoyISO())
    .order('creado_en', { ascending: false });
  if (error) {
    console.error('Error cargando gastos:', error.message);
    return;
  }
  gastosCache = data || [];
}

async function cargarCierres() {
  const { data, error } = await supabaseClient
    .from('cierres_diarios')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(30);
  if (error) {
    console.error('Error cargando cierres:', error.message);
    return;
  }
  cierresCache = data || [];
}

function ingresosDeHoy() {
  return pedidosCache
    .filter(p => !p.es_prueba && esHoy(p.creado_en) && p.estado !== 'Cancelado')
    .reduce((sum, p) => sum + Number(p.total || 0), 0);
}

function egresosDeHoy() {
  return gastosCache.reduce((sum, g) => sum + Number(g.monto || 0), 0);
}

// ---------------------------------------------------------------
// CAJA: RENDER
// ---------------------------------------------------------------
function renderCaja() {
  const ingresos = ingresosDeHoy();
  const egresos = egresosDeHoy();
  const efectivoEstimado = ingresos - egresos;

  document.getElementById('kpiIngresosHoy').textContent = `$${ingresos.toFixed(2)}`;
  document.getElementById('kpiEgresosHoy').textContent = `$${egresos.toFixed(2)}`;
  document.getElementById('kpiEfectivoEstimado').textContent = `$${efectivoEstimado.toFixed(2)}`;

  renderTablaGastos();
  renderTablaCierres();
}

function renderTablaGastos() {
  const tbody = document.getElementById('gastosBody');
  const emptyEl = document.getElementById('gastosEmpty');

  if (!gastosCache.length) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = gastosCache.map(g => `
    <tr>
      <td class="order-hora">${formatearHora(g.creado_en)}</td>
      <td>${escapeHTML(g.concepto)}</td>
      <td>${escapeHTML(g.categoria)}</td>
      <td class="order-total">$${Number(g.monto).toFixed(2)}</td>
      <td><button class="cart-line-remove" data-gasto-id="${g.id}" type="button" aria-label="Eliminar gasto">✕</button></td>
    </tr>
  `).join('');
}

function renderTablaCierres() {
  const tbody = document.getElementById('cierresBody');
  const emptyEl = document.getElementById('cierresEmpty');

  if (!cierresCache.length) {
    tbody.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  tbody.innerHTML = cierresCache.map(c => {
    const dif = Number(c.diferencia);
    const difColor = dif === 0 ? 'var(--verde)' : (dif < 0 ? 'var(--rojo)' : '#8a6414');
    return `
      <tr>
        <td>${new Date(c.fecha + 'T12:00:00').toLocaleDateString('es-VE')}</td>
        <td>$${Number(c.ingresos).toFixed(2)}</td>
        <td>$${Number(c.egresos).toFixed(2)}</td>
        <td>$${Number(c.efectivo_esperado).toFixed(2)}</td>
        <td>$${Number(c.efectivo_contado).toFixed(2)}</td>
        <td style="color:${difColor}; font-weight:700;">${dif > 0 ? '+' : ''}$${dif.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

// Eliminar un gasto (por si se registró por error)
document.getElementById('gastosBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-gasto-id]');
  if (!btn) return;
  if (!confirm('¿Eliminar este gasto?')) return;
  const { error } = await supabaseClient.from('gastos').delete().eq('id', btn.dataset.gastoId);
  if (error) {
    alert('No se pudo eliminar: ' + error.message);
    return;
  }
  await cargarGastosHoy();
  renderCaja();
});

// ---------------------------------------------------------------
// MODAL: NUEVO GASTO
// ---------------------------------------------------------------
const gastoOverlay = document.getElementById('gastoOverlay');

document.getElementById('newGastoBtn').addEventListener('click', () => {
  document.getElementById('gastoForm').reset();
  gastoOverlay.classList.add('open');
});
document.getElementById('gastoClose').addEventListener('click', () => {
  gastoOverlay.classList.remove('open');
});
gastoOverlay.addEventListener('click', (e) => {
  if (e.target === gastoOverlay) gastoOverlay.classList.remove('open');
});

document.getElementById('gastoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nuevo = {
    concepto: document.getElementById('gastoConcepto').value.trim(),
    categoria: document.getElementById('gastoCategoria').value,
    monto: parseFloat(document.getElementById('gastoMonto').value) || 0,
    fecha: hoyISO(),
  };
  const { error } = await supabaseClient.from('gastos').insert(nuevo);
  if (error) {
    alert('No se pudo guardar el gasto: ' + error.message);
    return;
  }
  gastoOverlay.classList.remove('open');
  await cargarGastosHoy();
  renderCaja();
});

// ---------------------------------------------------------------
// MODAL: CERRAR CAJA DEL DÍA
// ---------------------------------------------------------------
const cierreOverlay = document.getElementById('cierreOverlay');

document.getElementById('cerrarCajaBtn').addEventListener('click', () => {
  const ingresos = ingresosDeHoy();
  const egresos = egresosDeHoy();
  const esperado = ingresos - egresos;

  document.getElementById('cierreForm').reset();
  document.getElementById('cierreIngresosTxt').textContent = `$${ingresos.toFixed(2)}`;
  document.getElementById('cierreEgresosTxt').textContent = `$${egresos.toFixed(2)}`;
  document.getElementById('cierreEsperadoTxt').textContent = `$${esperado.toFixed(2)}`;
  document.getElementById('cierreDiferenciaTxt').textContent = `Diferencia: $${(0 - esperado).toFixed(2)}`;

  cierreOverlay.classList.add('open');
});

document.getElementById('cierreClose').addEventListener('click', () => {
  cierreOverlay.classList.remove('open');
});
cierreOverlay.addEventListener('click', (e) => {
  if (e.target === cierreOverlay) cierreOverlay.classList.remove('open');
});

document.getElementById('cierreEfectivoContado').addEventListener('input', (e) => {
  const esperado = ingresosDeHoy() - egresosDeHoy();
  const contado = parseFloat(e.target.value) || 0;
  const diferencia = contado - esperado;
  document.getElementById('cierreDiferenciaTxt').textContent = `Diferencia: ${diferencia >= 0 ? '+' : ''}$${diferencia.toFixed(2)}`;
});

document.getElementById('cierreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ingresos = ingresosDeHoy();
  const egresos = egresosDeHoy();
  const esperado = ingresos - egresos;
  const contado = parseFloat(document.getElementById('cierreEfectivoContado').value) || 0;
  const notas = document.getElementById('cierreNotas').value.trim() || null;

  const registro = {
    fecha: hoyISO(),
    ingresos: ingresos,
    egresos: egresos,
    efectivo_esperado: esperado,
    efectivo_contado: contado,
    diferencia: contado - esperado,
    notas: notas,
  };

  const { error } = await supabaseClient
    .from('cierres_diarios')
    .upsert(registro, { onConflict: 'fecha' });

  if (error) {
    alert('No se pudo registrar el cierre: ' + error.message);
    return;
  }
  cierreOverlay.classList.remove('open');
  await cargarCierres();
  renderCaja();
});

// ---------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------
checkSession();
