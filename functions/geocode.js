// Proxy gratuito para ViaCEP, Nominatim (OpenStreetMap), OSRM e
// OpenRouteService (ORS) — versão Cloudflare Pages Function (roda na
// borda/edge do Cloudflare, equivalente à antiga Netlify Function).
//
// Por que isso existe: chamar essas APIs diretamente do navegador (fetch
// client-side) é pouco confiável — o Nominatim, em especial, costuma
// bloquear/derrubar (erro de CORS) requisições vindas de sites sem uma
// identificação adequada, e o navegador não permite que JavaScript
// defina um cabeçalho "User-Agent" customizado. Fazendo a chamada aqui,
// no servidor (Cloudflare Pages Function), evitamos o problema de CORS
// por completo e conseguimos identificar o app corretamente, como a
// política de uso do Nominatim pede.
//
// Nenhum serviço pago é usado por padrão e nenhuma chave é necessária
// para ViaCEP/Nominatim/OSRM. O OpenRouteService (ORS) é opcional e,
// mesmo sendo gratuito, exige que o usuário cadastre sua própria chave
// pessoal (obtida de graça em openrouteservice.org) em Configurações —
// essa chave é enviada apenas nesta chamada, nunca fica salva aqui no
// servidor nem no código-fonte.
//
// Arquivo em /functions/geocode.js (raiz do projeto) fica disponível
// automaticamente em /geocode — é assim que o roteamento de Functions do
// Cloudflare Pages funciona (baseado no caminho do arquivo, sem precisar
// configurar nada a mais).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), { status: status, headers: CORS_HEADERS });
}

export async function onRequestOptions() {
  return new Response('', { status: 204, headers: CORS_HEADERS });
}

// OpenRouteService Matrix: exige POST com corpo JSON e a chave do
// usuário no cabeçalho Authorization. Tratado à parte porque os outros
// tipos (cep/search/table) usam GET simples.
export async function onRequestPost(context) {
  try {
    var body = await context.request.json().catch(function () { return {}; });
    if (body.type === 'ors_matrix') {
      var apiKey = body.apiKey || '';
      var locations = body.locations || [];
      if (!apiKey) return jsonResp({ error: 'Chave do OpenRouteService ausente' }, 400);
      if (!Array.isArray(locations) || locations.length < 2) return jsonResp({ error: 'Localizações insuficientes' }, 400);

      var resp;
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 9000);
        resp = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json, application/geo+json, application/gpx+xml'
          },
          body: JSON.stringify({ locations: locations, metrics: ['distance', 'duration'] }),
          signal: ctrl.signal
        });
        clearTimeout(timer);
      } catch (fetchErr) {
        return jsonResp({ error: 'OpenRouteService indisponível', detail: String(fetchErr) }, 502);
      }
      var text = await resp.text();
      return new Response(text, { status: resp.status, headers: CORS_HEADERS });
    }
    return jsonResp({ error: 'Tipo de POST inválido' }, 400);
  } catch (err) {
    return jsonResp({ error: 'Erro interno no proxy (POST)', detail: String(err) }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    var params = new URL(context.request.url).searchParams;
    var type = params.get('type');
    var url;
    var fetchOpts = {
      headers: {
        // Identificação exigida pela política de uso do Nominatim:
        // https://operations.osmfoundation.org/policies/nominatim/
        'User-Agent': 'TransporteEscolarApp/1.0 (aplicativo de gestao de van escolar, uso pessoal)',
        'Accept': 'application/json'
      }
    };

    if (type === 'cep') {
      // ViaCEP: gratuito, sem limite documentado agressivo para uso normal.
      var cep = (params.get('cep') || '').replace(/\D/g, '');
      if (cep.length !== 8) return jsonResp({ error: 'CEP inválido' }, 400);
      url = 'https://viacep.com.br/ws/' + cep + '/json/';
    } else if (type === 'search') {
      // Nominatim: gratuito, uso justo (no máximo 1 req/seg, já
      // respeitado no app via fila no cliente).
      var q = params.get('q') || '';
      if (!q) return jsonResp({ error: 'Parâmetro q ausente' }, 400);
      url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(q);
    } else if (type === 'search_structured') {
      // Busca ESTRUTURADA do Nominatim: rua/cidade/estado/CEP como
      // campos separados, em vez de um texto livre único — evita que
      // nomes de rua repetidos em cidades diferentes "casem" errado.
      var qs = 'format=json&limit=1&countrycodes=br';
      var street = params.get('street'), city = params.get('city'), state = params.get('state'), postalcode = params.get('postalcode');
      if (street) qs += '&street=' + encodeURIComponent(street);
      if (city) qs += '&city=' + encodeURIComponent(city);
      if (state) qs += '&state=' + encodeURIComponent(state);
      if (postalcode) qs += '&postalcode=' + encodeURIComponent(postalcode);
      if (!street && !city && !postalcode) return jsonResp({ error: 'Nenhum campo de endereço informado' }, 400);
      url = 'https://nominatim.openstreetmap.org/search?' + qs;
    } else if (type === 'table') {
      // OSRM (servidor de demonstração público): gratuito, sem SLA garantido.
      var coords = params.get('coords') || '';
      if (!coords) return jsonResp({ error: 'Parâmetro coords ausente' }, 400);
      url = 'https://router.project-osrm.org/table/v1/driving/' + coords + '?annotations=duration,distance';
    } else {
      return jsonResp({ error: 'Parâmetro type inválido' }, 400);
    }

    var resp;
    try {
      var ctrl2 = new AbortController();
      var timer2 = setTimeout(function () { ctrl2.abort(); }, 8000);
      fetchOpts.signal = ctrl2.signal;
      resp = await fetch(url, fetchOpts);
      clearTimeout(timer2);
    } catch (fetchErr) {
      return jsonResp({ error: 'Serviço externo indisponível', detail: String(fetchErr) }, 502);
    }

    var text = await resp.text();
    return new Response(text, { status: resp.status, headers: CORS_HEADERS });
  } catch (err) {
    return jsonResp({ error: 'Erro interno no proxy', detail: String(err) }, 500);
  }
}
