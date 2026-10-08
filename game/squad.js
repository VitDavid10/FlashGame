/*
 * ARENAS por equipos (1v1 / 2v2 / 3v3) y AMIGOS — cliente.
 *
 * Dos paneles separados:
 *  - ARENAS: la lista de salas (1V1, 2V2, 3V3). Ves las salas que ha creado la gente y puedes
 *    UNIRTE, o crear la tuya pulsando una sala vacia, o dar a PARTIDA RAPIDA. Al buscar sale
 *    "BUSCANDO" con la opcion de jugar una practica mientras esperas (no se mete a nadie en
 *    partida sin querer).
 *  - AMIGOS: lista con presencia, susurros y el GRUPO. Desde aqui se invita a los amigos y asi se
 *    forma el grupo (1 a 3) con el que luego se entra a las salas. Un grupo de 2 va a salas 2V2.
 *
 * La identidad es la cuenta del airdrop: wallet o X, da igual cual (con X se ve su usuario y
 * foto; con solo la wallet, su resumen). Protocolo y reglas: server/squad.js y server/social.js.
 *
 * Una sola UI para PC y app: render() pinta dentro de los contenedores montados. En la app van
 * dentro de los paneles del hub (app-hub.js); en PC, en carteles propios (#sqPc, #sqPcFr).
 * El tamano se escala con `em`, asi que cada sitio fija su font-size.
 */
(function () {
    'use strict';
    const SIZES = [1, 2, 3];
    const SLOTS = 3;   // tarjetas por columna en la lista de salas
    const S = {
        ws: null, conn: 'idle', party: null, me: null, err: '', note: '',
        usd: (() => { try { return Math.max(0, Math.min(20, parseInt(localStorage.getItem('pw_arusd'), 10) || 0)); } catch (e) { return 0; } })(),   // precio elegido para QUICK MATCH (0 = gratis)
        rivals: [], quote: [], pillUsd: 0, prize: null, endMoney: null,
        box: { rooms: null, friends: null }, pc: {}, roster: null, rel: null,
        ticketTimer: null, practiceTimer: null, enterBusy: false, after: null,
        x: 'unknown', token: null, prof: null, idAt: 0,
        friends: { friends: [], inReq: [], outReq: [] }, rooms: [], chat: {}, chatWith: null, unread: {}, roomsTimer: null, watch: (() => { try { return JSON.parse(localStorage.getItem('pw_fwatch')) || {}; } catch (e) { return {}; } })(),
        invites: [],
        mute: (() => { try { return JSON.parse(localStorage.getItem('pw_wmute')) || { all: false, ids: {} }; } catch (e) { return { all: false, ids: {} }; } })(),
    };
    const EN_APP = document.documentElement.classList.contains('pw-app');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const snd = n => { try { SoundManager.play(n); } catch (e) {} };
    // Dolares con 2 decimales como mucho ($2, $2.02).
    const EMOJIS = ['😀', '😂', '😎', '😜', '😡', '😭', '👍', '👎', '🔥', '💀', '🎉', '💊', '🤝', '👀', '🙏', '💰', '🚀', '❤️'];
    const fmtUsd = n => { const v = Math.round((+n || 0) * 100) / 100; return '$' + (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2).replace(/\.00$/, '')); };
    const fmtPill = n => (n | 0).toLocaleString('en-US') + ' $PILLY';
    window.pwUsd = fmtUsd;
    const fmtK = n => { n = Math.round(+n || 0); const a = Math.abs(n);
        if (a < 1000) return String(n);
        const [d, u] = a < 999500 ? [1e3, 'K'] : [1e6, 'M'], v = n / d, av = Math.abs(v);
        const t = av < 10 ? v.toFixed(2) : av < 100 ? v.toFixed(1) : String(Math.round(v));
        return (t.includes('.') ? t.replace(/\.?0+$/, '') : t) + u; };
    window.pwFmtK = fmtK;
    const ERRS = {
        pay_failed: 'The entry payment failed.', in_custom: 'You are in a custom room.', team_full: 'That team is full.', too_many: 'Too many players to go back to a normal group.', pay_off: 'Paid matches are not available right now.',
        no_party: 'That group is gone.', party_full: 'That group is full (3 players).', party_busy: "You can't do that while your group is searching.",
        not_leader: 'Only the group leader can do that.', size_mismatch: 'Your group size does not match that room.', already_in_party: 'You are already in a group.',
        bad_token: 'Could not verify your account. Reopen this panel.', need_x: 'Connect your wallet to use friends.',
        no_such_user: 'Nobody with that X name or wallet has opened Arenas yet.', self: "That's you!", already_friends: 'You are already friends.',
        already_requested: 'Request already sent.', friends_full: 'Friends list is full.', requests_full: 'That player has too many pending requests.',
        no_request: 'That request is gone.', not_friends: 'You can only do that with friends.', no_open_party: 'Invite a friend first.',
        offline: 'That friend is offline.', slow_down: 'Slow down a little.', room_gone: 'That room is no longer available.', price_mismatch: 'That group plays at a different price.',
    };
    const ST = { on: 'ONLINE', party: 'IN A GROUP', wait: 'WAITING MATCH', game: 'IN A MATCH', off: 'OFFLINE' };
    // Como se ve a alguien en grupos y amigos: su @ de X o, sin X, el resumen de su wallet. (El nombre que pone en THE PILL solo
    // sale sobre su pildora en el mapa.) A los amigos se les puede poner un apodo, solo tuyo.
    const nameOf = o => (o.u ? '@' + o.u : (o.n || 'PLAYER'));
    let nicks = {}; try { nicks = JSON.parse(localStorage.getItem('pw_nicks')) || {}; } catch (e) { nicks = {}; }
    const friendName = o => nicks[o.id] || nameOf(o);
    function setNick(id, v) {
        v = String(v || '').replace(/[<>]/g, '').trim().slice(0, 16);
        if (v) nicks[id] = v; else delete nicks[id];
        try { localStorage.setItem('pw_nicks', JSON.stringify(nicks)); } catch (e) {}
    }
    const initial = o => esc(String(o.u || o.n || '?').replace(/^@/, '').slice(0, 1).toUpperCase());

    const css = `
/* En el movil el juego se gira por CSS (--pw-largo/--pw-corto): todo lo que cuelga de body y no va dentro de un contenedor
   girado sale tumbado. Los carteles de arenas viven en este marco, que se gira igual que #loadingScreen. */
#sqFrame{position:fixed;inset:0;z-index:9990;pointer-events:none}
@media (pointer: coarse){html:not([data-hero]) body.mobile-allowed #sqFrame{inset:auto;width:100vh;height:100vw;width:var(--pw-largo,100dvh);height:var(--pw-corto,100dvw);top:50%;left:50%;transform:translate(-50%,-50%) rotate(90deg);transform-origin:center}}
.sq{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.8em;padding:.4em .8em .2em}
.sq *{box-sizing:border-box}
.sq-t{font-size:.9em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000;letter-spacing:.06em}
.sq-p{font-size:.4em;line-height:2;color:#cfd8d3;max-width:38em}
.sq-row{display:flex;gap:.8em;align-items:center;justify-content:center;flex-wrap:wrap;width:100%}
.sq-b{font-family:'Russo One',sans-serif;font-size:.74em;letter-spacing:.1em;padding:.6em 1.2em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer;min-width:5.6em}
.sq-b.sm{font-size:.5em;padding:.45em .9em;min-width:0}
.sq-b.on{background:var(--ac,#00ff88);border-color:var(--ac,#00ff88);color:#04150c}
.sq-b.gold{background:#ffd23a;border-color:#ffd23a;color:#241a00}
.sq-b.red{border-color:#7a2a26;color:#ff8a7a}
.sq-b:disabled{opacity:.35;cursor:default}
.sq-b:active:not(:disabled){transform:translateY(.1em)}
.sq-in{font-family:'Press Start 2P',monospace;font-size:.5em;color:#fff;background:#050c09;border:.2em solid #2c3630;padding:1em .9em;outline:none;width:100%;letter-spacing:.02em}
.sq-in:focus{border-color:var(--ac,#00ff88)}
.sq-lab{font-size:.36em;color:#7d8a82;letter-spacing:.14em}
.sq-err{font-size:.4em;color:#ff6a5a;min-height:1.6em;line-height:1.8}
.sq-ok{color:#00ff66}
.sq-q{font-size:.6em;color:#9bbfff;letter-spacing:.1em;animation:sqB 1s steps(2) infinite}
@keyframes sqB{50%{opacity:.35}}
.sq-note{font-size:.38em;line-height:2;color:#8aa096;max-width:36em}
.sq-pic{width:2.2em;height:2.2em;border-radius:50%;object-fit:cover;background:#16201b;box-shadow:0 0 0 .12em #000;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:.8em;color:#7d8a82}
/* grupo: foto y nombre debajo */
.sq-grp{display:flex;gap:1.2em;justify-content:center;align-items:flex-start;width:100%}
.sq-av{display:flex;flex-direction:column;align-items:center;gap:.6em;width:7em}
.sq-av .sq-pic{width:3.4em;height:3.4em;font-size:1.1em}
.sq-av .lb{display:contents}
.sq-av .n{font-size:.42em;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-av.me .sq-pic{box-shadow:0 0 0 .16em var(--ac,#00ff88)}
.sq-av .l{font-size:.32em;color:#ffd23a;letter-spacing:.1em;margin-top:-.3em}
.sq-av.empty .sq-pic{background:none;border:.14em dashed #34423a;box-shadow:none}
.sq-pic{overflow:hidden}
#ahArBody{height:15.5em;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;justify-content:center}   /* mismo alto siempre: el panel no cambia de tamano al cambiar de pantalla */
#ahArBody>.sq{width:100%;box-sizing:border-box}
#ahFrBody{height:15.5em;overflow-y:auto}
.sq-tabs{display:flex;gap:.5em;width:100%}
.sq.sq-fixed{height:100%;box-sizing:border-box;justify-content:flex-start}
.sq-tab{flex:1;font-family:inherit;font-size:.5em;letter-spacing:.1em;padding:.7em;background:none;border:.14em solid #2f3d35;color:#7d8a82;cursor:pointer}
.sq-tab.on{border-color:var(--ac,#00ff88);color:var(--ac,#00ff88)}
.sq-tab:disabled{opacity:.35}
.sq-gw{flex:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:0}   /* el panel no se sale de la pantalla: con grupo la lista hace scroll dentro */
/* amigos: la lista usa todo el alto del panel (si no, con 3 amigos el tercero quedaba cortado) y las filas son mas bajas */
#ahFrBody .sq-list{max-height:none;overflow:visible;gap:.4em}
#ahFrBody .sq-it{padding:.3em .7em}
#ahFrBody .sq-it .sq-pic{width:1.8em;height:1.8em}
.sq-pic .av,.sq-pic .av-cv{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center}
.sq-pic .av svg{width:60%;height:60%}
.sq-pic canvas{image-rendering:pixelated}
/* buscando: los jugadores son lo central, grandes, y los botones van abajo */
.sq.find{min-height:13.5em;justify-content:space-between;gap:.6em}
.sq.find .mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8em;width:100%}
.sq-grp.big{flex:none;align-items:center;gap:2.6em}
/* en AMIGOS el grupo es una tira compacta: si no, con tres jugadores el panel se sale de la pantalla */
.sq-grp.small{gap:.8em}
.sq-grp.small .sq-av{width:6.2em;gap:.4em}
.sq-grp.small .sq-av .sq-pic{width:2.5em;height:2.5em;font-size:1em}
.sq-grp.small .sq-av .n{font-size:.4em}
.sq-grp.big .sq-av{width:12em;gap:.9em}
.sq-grp.big .sq-av .sq-pic{width:4.6em;height:4.6em;font-size:1.4em}
.sq-grp.big .sq-av .n{font-size:.55em}
.sq-grp.big .sq-av .l{font-size:.36em}
.sq-bot{display:flex;flex-direction:column;align-items:center;gap:.8em;width:100%}
.sq.find .sq-bot{margin-bottom:0}
.sq-err:empty{display:none}
/* FIN DE PARTIDA (diseno C): fondo oscuro, banda en diagonal, VICTORY verde / DEFEAT rojo */
#sqEnd{--bgc:#090b00;--grid:rgba(60,75,8,.55);--acc:#ccff00;--acL:#e6ff80;--acD:#708c00;--p1:#0b0e01;--p2:#050700;--mb1:#5d6e2a;--mb2:#232d08;
  --ec:#ff4d6d;--ecd:#661f2c;--t1:#2e0d1a;--t2:#1b0711;--pc:#ff4d6d;
  font-size:min(1.25vmax,2.7vmin);position:absolute;inset:0;z-index:300;pointer-events:auto;display:none;font-family:'Press Start 2P',monospace;color:#fff;overflow:hidden;
  background-color:var(--bgc);background-image:linear-gradient(var(--grid) .083em,transparent .083em),linear-gradient(90deg,var(--grid) .083em,transparent .083em);background-size:2.667em 2.667em;background-position:.583em 1.25em}
body[data-modo="classic"] #sqEnd{--bgc:#03100b;--grid:rgba(11,51,38,.95);--acc:#00ffaa;--acL:#80ffd5;--acD:#008c5e;--p1:#0a1a13;--p2:#04100b;--mb1:#2c6a55;--mb2:#0f2a20}   /* el fondo sigue al modo desde el que se entro */
#sqEnd.win{--ec:#00ff88;--ecd:#00663a;--t1:#0a2e1e;--t2:#061c13;--pc:#ffd23a}
#sqEnd.draw{--ec:#ffd23a;--ecd:#66540f;--t1:#2e280a;--t2:#1c1706;--pc:#ffd23a}
#sqEnd.show{display:block;animation:seFade .3s ease both}
@keyframes seFade{from{opacity:0}to{opacity:1}}
#sqEnd canvas.fx{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;z-index:0}
#sqEnd .band{z-index:1}#sqEnd .bts{z-index:2}
#sqEnd .band{position:absolute;left:-4%;right:-4%;top:27%;height:58%;transform:rotate(-4deg);border-top:0.7em solid transparent;border-bottom:0.7em solid transparent;background:linear-gradient(var(--ec),var(--ec)) top/100% .22em no-repeat,linear-gradient(var(--ec),var(--ec)) bottom/100% .22em no-repeat,linear-gradient(180deg,var(--t1),var(--t2));background-origin:border-box;background-clip:border-box;box-shadow:0 .3em 0 rgba(0,0,0,.6)}
#sqEnd .t{position:absolute;left:0;right:0;top:-36%;text-align:center;font-size:5.6em;color:var(--ec);text-shadow:.07em .07em 0 var(--ecd);animation:seT .5s cubic-bezier(.2,1.4,.3,1) both}   /* 3D: sombra del mismo color en tono oscuro, sin contorno ni recuadro */
#sqEnd .cols{position:absolute;inset:2% 8% 3% 9%;display:flex;gap:4%;align-items:flex-start}
#sqEnd .tms{flex:1.25;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:space-between}
#sqEnd:not(.n2):not(.n3) .tms{justify-content:center;gap:3em}
#sqEnd .tms>div{position:relative;padding-top:2.7em}
#sqEnd.n2 .tms>div,#sqEnd.n3 .tms>div{padding-top:2.5em}
/* YOUR TEAM / RIVALS: pestaña de color por encima de la primera barra */
#sqEnd .h{position:absolute;left:4.6em;top:.15em;margin:0;display:inline-block;font-size:.72em;letter-spacing:.12em;color:#0b0f05;padding:.55em .9em .45em;box-shadow:0 0 0 .2em #000;z-index:2}
#sqEnd .h.me{background:#1d9bf0}#sqEnd .h.foe{background:#ff4d6d}
/* cada jugador = barra del menu con la foto saliendo por la izquierda; todos iluminados */
#sqEnd .rw{position:relative;display:flex;align-items:center;gap:1.2em;margin-bottom:1.15em}
#sqEnd .tms>div .rw:last-child{margin-bottom:0}
#sqEnd .rw.me{--tc:#1d9bf0}#sqEnd .rw.foe{--tc:#ff4d6d}
#sqEnd .rw:before{content:"";position:absolute;left:1.5em;right:-.5em;top:50%;height:calc(100% + .7em);transform:translateY(-50%);background:linear-gradient(180deg,var(--p1),var(--p2));border:.14em solid var(--tc);box-shadow:.2em .3em 0 rgba(0,0,0,.6);z-index:0}
#sqEnd .rw>*{position:relative;z-index:1}
#sqEnd .rw .ph .sq-pic{width:3.5em;height:3.5em;border-radius:0;box-shadow:0 0 0 .3em var(--tc),.3em .3em 0 .3em #000}
#sqEnd .rw .nm{width:34%;font-size:1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sqEnd .rw .k{font-family:'VT323',monospace;font-size:1.9em;color:#ffce3d;width:22%;white-space:nowrap}
#sqEnd .rw .pk{font-family:'VT323',monospace;font-size:1.9em;color:#e8e8e8;white-space:nowrap}
#sqEnd .rw .pk.bot{color:#ff3b3b}   /* comido por un bot: en rojo (ya con el 10 % de casa descontado) */
#sqEnd.n2 .rw .ph .sq-pic{width:3em;height:3em}
#sqEnd.n2 .rw{margin-bottom:.95em}#sqEnd.n2 .rw:before{height:calc(100% + .45em)}
#sqEnd.n3 .rw{margin-bottom:.85em}#sqEnd.n3 .rw:before{height:calc(100% + .35em)}
#sqEnd.n3 .rw .ph .sq-pic{width:2em;height:2em}#sqEnd.n3 .rw .k,#sqEnd.n3 .rw .pk{font-size:1.45em}#sqEnd.n3 .rw .nm{font-size:.85em}
/* premio / perdido / gratis: barra de una linea centrada en su zona; CLAIM cuelga debajo sin mover la barra */
#sqEnd .prz{position:relative;flex:1;align-self:stretch;display:flex;align-items:center;justify-content:center}
#sqEnd .pw{position:relative}
#sqEnd .pbar{position:relative;display:inline-flex;align-items:center;justify-content:center;height:3.9em;padding:0 1.7em;white-space:nowrap;background:linear-gradient(180deg,var(--p1),var(--p2));border:.14em solid var(--pc);box-shadow:.2em .3em 0 rgba(0,0,0,.6)}
#sqEnd.n3 .pbar{height:3.5em}
#sqEnd .pbar:before{content:attr(data-t);position:absolute;left:1em;top:0;transform:translateY(-62%);font-size:.72em;letter-spacing:.12em;background:var(--pc);color:#0b0f05;padding:.55em .9em .45em;box-shadow:0 0 0 .2em #000}
#sqEnd .pbar .line{display:block;line-height:1}
#sqEnd .pbar .pa{display:inline;font-family:'VT323',monospace;font-weight:400;font-size:2.1em;line-height:1;color:#ffd23a}
#sqEnd .pbar .pu{display:inline;margin-left:.7em;font-family:'VT323',monospace;font-size:1.7em;line-height:1;color:#e8e8e8}
#sqEnd .pbar .pf{font-family:'VT323',monospace;font-size:1.55em;line-height:1;color:#e8e8e8}#sqEnd .pbar .pf b{font-weight:400;color:#ffd23a}
#sqEnd .pw .clr{position:absolute;left:50%;top:calc(100% + 1.1em);transform:translateX(-50%);display:flex;align-items:center;gap:1em;white-space:nowrap}
#sqEnd .prz .cl{font-family:'Press Start 2P',monospace;font-size:1.1em;padding:0 1.6em;height:2.8em;border-radius:1.3em;border:.18em solid;border-color:#ffe98a #9a7a10 #9a7a10 #ffe98a;background:#ffd23a;color:#0b0f05;box-shadow:0 0 0 .12em #000,.12em .2em 0 .1em rgba(0,0,0,.55);cursor:pointer}
#sqEnd .prz .cl:disabled{background:#2c3630;color:#9fb0a6;border-color:#4a554e #1c231f #1c231f #4a554e;cursor:default}
#sqEnd .prz .pl{font-family:'Press Start 2P',monospace;font-size:1em;line-height:1.1;color:#fff;text-align:left}
/* botones como el PLAY del menu, abajo a la derecha (no cruzan el borde de la franja) */
#sqEnd .bts{position:absolute;left:0;right:2.2%;bottom:3%;display:flex;justify-content:flex-end;gap:1.6em}
#sqEnd .bts button{box-sizing:border-box;font-family:'Press Start 2P',monospace;font-size:1.4em;padding:0 2em;height:3.2em;display:inline-flex;align-items:center;justify-content:center;border-radius:1.7em;background:var(--acc);color:#04150c;border:.2em solid;border-color:var(--acL) var(--acD) var(--acD) var(--acL);box-shadow:0 0 0 .14em #000,inset 0 0 0 .12em #000,.15em .25em 0 .12em rgba(0,0,0,.55);cursor:pointer}
#sqEnd .bts button.o{background:linear-gradient(180deg,var(--p1),var(--p2));color:#e8e8e8;border-color:var(--mb1) var(--mb2) var(--mb2) var(--mb1)}
@keyframes seT{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
/* ENTRADA A LA PARTIDA (diseno C animado) */
.ci{--bgc:#090b00;--grid:rgba(60,75,8,.55);--acc:#ccff00;--edge:#3d4a14;--p1:#0b0e01;--p2:#050700;
  font-size:min(1.25vmax,2.7vmin);position:absolute;inset:0;overflow:hidden;font-family:'Press Start 2P',monospace;color:#fff;
  background-color:var(--bgc);background-image:linear-gradient(var(--grid) .083em,transparent .083em),linear-gradient(90deg,var(--grid) .083em,transparent .083em);background-size:2.667em 2.667em;background-position:.583em 1.25em;animation:ciIn .3s both}
body[data-modo="classic"] .ci{--bgc:#03100b;--grid:rgba(11,51,38,.95);--acc:#00ffaa;--edge:#1d4a3b;--p1:#0a1a13;--p2:#04100b}   /* el fondo sigue al modo desde el que se entro (arenas es el mismo juego) */
.ci:before{display:none}
.ci .bd{position:absolute;left:-6%;right:-6%;height:calc(36% + .16em);box-sizing:content-box;background:#0b0f05;transform:rotate(-4deg);box-shadow:0 .3em 0 rgba(0,0,0,.6)}
.ci .bd.ba{top:calc(13% - 1.667em);background:linear-gradient(180deg,#0c2438,#071827);border-top:.22em solid #1d9bf0;border-bottom:.22em solid #1d9bf0;animation:ciL .5s .15s cubic-bezier(.2,.9,.3,1) both}
.ci .bd.bb{top:calc(55% - 1.667em);background:linear-gradient(180deg,#2e0d1a,#1b0711);border-top:.22em solid #ff4d6d;border-bottom:.22em solid #ff4d6d;animation:ciR .5s 1.45s cubic-bezier(.2,.9,.3,1) both}
.ci .row{position:absolute;left:8%;top:-.79em;display:flex;justify-content:center;gap:5%;width:44.8%}   /* 3 fotos llenan el hueco; 1 o 2 quedan centradas en el; la foto sobresale por arriba de la franja */
.ci .ti{position:relative;display:flex;flex-direction:column;align-items:center;gap:0.8em;width:30%;flex:none;animation:ciPop .35s cubic-bezier(.2,1.4,.3,1) both}
.ci .ti .sq-pic{width:10.5em;height:10.5em;border-radius:0}
.ci .ti.me .sq-pic{box-shadow:0 0 0 0.5em #1d9bf0,0.6em 0.6em 0 0.5em #000,0 0 2.2em rgba(29,155,240,.5)}
.ci .ti.foe .sq-pic{box-shadow:0 0 0 0.5em #ff4d6d,0.6em 0.6em 0 0.5em #000,0 0 2.2em rgba(255,77,109,.5)}
.ci .ti.me{--c:#1d9bf0}.ci .ti.foe{--c:#ff4d6d}
.ci .ti .nm{position:absolute;left:50%;top:calc(100% + 1.76em);transform:translateX(-50%);z-index:2;font-size:.71em;max-width:190%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:linear-gradient(180deg,var(--p1),var(--p2));border:.14em solid var(--c);padding:.5em .8em .45em;box-shadow:.2em .3em 0 rgba(0,0,0,.6)}
.ci .pl4{position:absolute;right:12%;top:30%;display:flex;gap:1.6em}
.ci .pl4 i{display:block;width:1.6em;height:3.2em;border-radius:0.9em;transform:rotate(-45deg);box-shadow:0 0 0 0.2em #000}
.ci .pl4.pa i{background:linear-gradient(#e8f6ff 50%,#1d9bf0 50%)}.ci .pl4.pb i{background:linear-gradient(#fff 50%,#ff4d6d 50%)}
.ci .vs{position:absolute;left:58%;top:calc(40% - .214em);font-size:7.8em;color:#fff;-webkit-text-stroke:.064em #0b0f05;paint-order:stroke fill;text-shadow:.1em .1em 0 #0b0f05;transform:rotate(-4deg);animation:ciVs .45s 1.05s cubic-bezier(.2,1.6,.3,1) both;z-index:2}
.ci .tt{position:absolute;left:2.5%;top:1.29em;font-size:1.15em;color:#fff;text-shadow:.16em .16em 0 #000;display:flex;align-items:center;gap:.8em}
.ci .pz{display:inline-flex;align-items:center;gap:.4em;background:#0b0f05;color:#ffd23a;padding:.35em .6em;font-size:.8em}
.ci .pz.free{color:#00ff88}
.ci .stk{position:absolute;left:61%;width:33%;height:33%;display:flex;align-items:center;justify-content:center;text-align:center;z-index:3;opacity:0;transform:rotate(-4deg) scale(.5);transition:opacity .25s,transform .3s cubic-bezier(.2,1.4,.3,1)}
.ci .stk.on{opacity:1;transform:rotate(-4deg) scale(1)}   /* lo enciende un temporizador (intro): con retardo de CSS, en el movil la de abajo no llegaba a salir */
.ci .stk.sk-me{top:calc(7% - 1.667em);--c:#1d9bf0}.ci .stk.sk-foe{top:calc(58% - 1.667em);--c:#ff4d6d}   /* ojo: nada de clases sueltas 'a'/'b' aqui, #sqEntry oculta cualquier .b en la VS */
.ci .stk .in{position:relative;display:flex;flex-direction:column;align-items:center;padding:1.55em 1.5em .95em;background:linear-gradient(180deg,var(--p1),var(--p2));border:.16em solid var(--c);box-shadow:.2em .3em 0 rgba(0,0,0,.6)}
.ci.stk3 .pl4{display:none}
.ci .stk .sl{position:absolute;left:1em;top:0;transform:translateY(-62%);font-size:.7em;letter-spacing:.12em;background:var(--c);color:#0b0f05;padding:.55em .9em .45em;box-shadow:0 0 0 .2em #000;white-space:nowrap}
.ci .stk .sv{font-size:1.9em;color:#ffd23a;text-shadow:.12em .12em 0 #000;white-space:nowrap;line-height:1}
.ci .stk.sm .sv{font-size:1.45em}
.ci .stk .sv .ap{font-family:'VT323',monospace;font-size:1.5em;line-height:0;vertical-align:-.08em;color:#fff}
.ci .stk.free .sv{color:#00ff88;font-size:2.4em}
.ci .pl4 canvas.px{display:block;height:4.2em;image-rendering:pixelated;background:none;box-shadow:none;border:0}
@keyframes ciIn{from{opacity:0}to{opacity:1}}
@keyframes ciL{from{transform:translateX(-110%) rotate(-4deg)}to{transform:translateX(0) rotate(-4deg)}}
@keyframes ciR{from{transform:translateX(110%) rotate(-4deg)}to{transform:translateX(0) rotate(-4deg)}}
@keyframes ciPop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes ciVs{from{transform:scale(3) rotate(-4deg);opacity:0}to{transform:scale(1) rotate(-4deg);opacity:1}}
/* tarjetas 1V1/2V2/3V3 con dibujo */
.sq-card{padding:.5em .5em .7em;gap:.5em}
.sq-card canvas.cvc{width:100%;height:auto;image-rendering:pixelated;display:block;box-shadow:0 0 0 .1em #000}
.sq-card .tag{font-size:.42em;color:#e8e8e8;letter-spacing:.1em}
/* en las batallas (entrada y resultados) la foto va CUADRADA y entera, como en X; redonda solo en perfil y listas */
.ci .sq-pic,.ci .sq-pic .av,.ci .sq-pic .av-cv,.ci .sq-pic img,#sqEnd .sq-pic,#sqEnd .sq-pic .av,#sqEnd .sq-pic .av-cv{border-radius:0}
/* ARENAS: tres tarjetas grandes con dibujo (pildoras azules contra rojas) y sin scroll */
.sq-cards{display:flex;gap:1em;width:100%}
.sq-card{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7em;padding:1.1em .4em;background:rgba(0,0,0,.3);border:.14em solid #2f3d35;cursor:pointer}
.sq-card .big{font-size:1.3em;color:var(--ac,#00ff88);text-shadow:.1em .1em 0 #000}
.sq-card.dim{opacity:.45}
.sq-card:active{border-color:var(--ac,#00ff88)}
.sq-card{flex-direction:column}
.sq-menu{display:flex;flex-direction:column;gap:.7em;width:100%;align-items:center}
.sq-b.big{width:78%;font-size:1.05em;padding:.7em 1em}
.sq-chip{font-size:.4em;letter-spacing:.1em;padding:.4em .8em;border:.12em solid #2f3d35;color:#7d8a82}
.sq-chip.on{border-color:var(--ac,#00ff88);color:var(--ac,#00ff88)}
.sq-chip.off{opacity:.55}
/* Arenas de pago: selector de precio (0-20 $) y FIND RIVALS por tramos */
.sq-price{display:flex;align-items:center;justify-content:center;gap:.8em;width:78%}
.sq-price .sq-b{font-size:.9em;min-width:0;padding:.35em .8em}
.sq-price .v{flex:1;text-align:center;display:flex;flex-direction:column;gap:.35em}
.sq-price .v b{font-family:'Russo One',sans-serif;font-weight:400;font-size:1.25em;letter-spacing:.08em;color:#ffd23a}
.sq-price .v b.free{color:var(--ac,#00ff88)}
.sq-price .v span{font-size:.36em;color:#7d8a82;letter-spacing:.12em}
.sq-rv-h{font-size:.4em;letter-spacing:.14em;color:#ffd23a;margin:.5em 0 .1em;text-align:left}
.sq-rv-h.free{color:var(--ac,#00ff88)}
.sq-rm .pr{font-family:'Russo One',sans-serif;font-size:.62em;color:#ffd23a;min-width:3.2em;text-align:left}
.sq-rm .pr.free{color:var(--ac,#00ff88)}
.sq-rm .s b{color:#00ff88;font-weight:400}.sq-rm .s i{font-style:normal;color:#ffb347}
.sq-rm.dim{opacity:.55}
.sq-pl{font-family:'Russo One',sans-serif;font-size:.5em;letter-spacing:.08em;color:#cfd8d3;text-align:center}
.sq-pl b{font-weight:400;color:#ffd23a}.sq-pl.free{color:var(--ac,#00ff88)}
.sq-row .sq-pl{flex:1}
.sq-b.sq-ghost{visibility:hidden}
.sq-side{display:flex;align-items:center;justify-content:center;gap:2em;width:100%}
.sq-side .sq-grp{width:auto}
.sq-side.n3{gap:1.4em}.sq-side.n3 .sq-grp.big{gap:1.2em}.sq-side.n3 .sq-grp.big .sq-av{width:5.6em}.sq-side.n3 .sq-grp.big .sq-av .sq-pic{width:3.8em;height:3.8em}
.sq-side.n3 .sq-pbox{min-width:6.5em;padding-left:.9em}
.sq.find .sq-bot{margin-top:.4em}
.sq-pbox{display:flex;flex-direction:column;align-items:flex-start;gap:.4em;padding:.1em 0 .1em 1.1em;border-left:.14em solid rgba(255,210,58,.55);min-width:8em;text-align:left}
.sq-pbox .sep{height:.5em}
.sq-pbox .k{font-size:.36em;letter-spacing:.14em;color:#7d8a82}
.sq-pbox .u{font-family:'Russo One',sans-serif;font-size:1em;color:#ffd23a}.sq-pbox .u.free{color:var(--ac,#00ff88)}
.sq-pbox .t{font-family:'Russo One',sans-serif;font-size:.48em;letter-spacing:.06em;color:#cfd8d3}.sq-pbox .t.g{color:#ffd23a}
.sq-wt{font-size:.34em;line-height:1.6;letter-spacing:.06em;color:#ffb347;max-width:17em;text-align:left;margin-top:.3em}.sq-wt.rd{color:#00ff88}
.sq-pbox .sq-b{margin-top:.3em}
.sq-cm{display:flex;align-items:center;justify-content:center;gap:1em;width:100%;flex:1;min-height:0}
.sq-cm .tm{flex:1;display:flex;flex-direction:column;align-items:center;gap:.5em;padding:.5em;border:.07em solid rgba(255,255,255,.1);background:rgba(0,0,0,.25)}
.sq-cm .tm .h{font-size:.42em;letter-spacing:.14em}.sq-cm .tm.a .h{color:#3fa0ff}.sq-cm .tm.b .h{color:#ff6a5a}
.sq-cm .vs{font-family:'Press Start 2P',monospace;font-size:.7em;color:#ffd23a}
.sq-code{font-weight:400;color:#ffd23a;letter-spacing:.2em;user-select:all}
.sq-av .k.mv{color:#00ff88;border-color:#00ff88;cursor:pointer}
.sq-cmh{display:flex;align-items:center;justify-content:space-between;width:100%}
.sq-cmh .sz{display:flex;gap:.4em}
.sq-cmw{gap:.7em}
.sq-cm .tm{align-self:stretch;justify-content:center;gap:.8em}
.sq-cm .sq-grp.small{gap:.8em}
.sq-cm .sq-grp.small .sq-av{width:6em;gap:.45em}
.sq-cm .sq-grp.small .sq-av .sq-pic{width:3.4em;height:3.4em;font-size:1.2em}
.sq-cm .sq-grp.small .sq-av .n{font-size:.42em}
.sq-cm.n3 .sq-grp.small{gap:.5em}
.sq-cm.n3 .sq-grp.small .sq-av{width:4.8em;gap:.35em}
.sq-cm.n3 .sq-grp.small .sq-av .sq-pic{width:2.7em;height:2.7em;font-size:1em}
.sq-cm.n3 .sq-grp.small .sq-av .n{font-size:.34em}.sq-cm.n3 .sq-grp.small .sq-av .l,.sq-cm.n3 .sq-av .k{font-size:.3em}
.sq-cm.n3 .tm{padding:.5em .3em}
.sq-rl{width:100%;display:flex;flex-direction:column;gap:.5em;flex:1;min-height:0;overflow-y:auto}
/* pantallas de arenas: cabecera arriba (BACK + modo), filtros debajo y el contenido ocupando el resto */
.sq-empty{margin:auto;text-align:center;line-height:1.8}
.sq-fixed .sq-menu{flex:1;justify-content:center}
.sq-b.blink{animation:sqBlink .7s steps(2) infinite;border-color:#ffd23a;color:#ffd23a}
@keyframes sqBlink{50%{background:#ffd23a;color:#04150c}}
#sqGuard{position:absolute;inset:0;z-index:420;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);pointer-events:auto;font-family:'Press Start 2P',monospace;color:#fff}
#sqGuard.show{display:flex}
#sqGuard .bx{background:#0a110d;border:3px solid #ffb347;padding:16px 18px;max-width:78%;text-align:center;display:flex;flex-direction:column;gap:14px;font-size:9px;line-height:1.7}
#sqGuard .bx .r{display:flex;gap:10px;justify-content:center}
.sq-av .k{font-size:.4em;color:#e5302f;cursor:pointer;padding:.2em .6em;border:.14em solid #5a2420}
/* lista de salas */
.sq-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:1em;width:100%}
.sq-col{display:flex;flex-direction:column;gap:.5em;min-width:0}
.sq-ch{font-size:.62em;letter-spacing:.1em;color:var(--ac,#00ff88);text-shadow:.12em .12em 0 #000}
.sq-col.dim .sq-ch{color:#56635b}
.sq-rm{display:flex;align-items:center;gap:.7em;min-height:2.9em;padding:.4em .7em;background:rgba(0,0,0,.3);border:.07em solid rgba(255,255,255,.1);text-align:left;min-width:0}
.sq-rm .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.5em}
.sq-rm .sq-pic{width:1.9em;height:1.9em}
.sq-rm .n{font-size:.45em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-rm .s{font-size:.32em;color:#7d8a82;letter-spacing:.08em}
.sq-rm.empty{border:.12em dashed #2f3d35;background:none;justify-content:center;flex-direction:column;gap:.35em;cursor:pointer;text-align:center}
.sq-rm.empty .n{color:#5d6b63}
.sq-rm.empty .s{letter-spacing:.3em;color:#3d4a43}
.sq-rm.empty:active{border-color:var(--ac,#00ff88)}
.sq-col.dim .sq-rm{opacity:.5}
.sq-more{max-height:10.5em;overflow:auto;display:flex;flex-direction:column;gap:.5em}
/* amigos */
.sq-list{width:100%;max-height:9em;overflow:auto;display:flex;flex-direction:column;gap:.6em;text-align:left;padding-right:.2em}
.sq-it{display:flex;align-items:center;gap:.9em;background:rgba(0,0,0,.28);border:.07em solid rgba(255,255,255,.08);padding:.6em .8em}
.sq-it .w{flex:1;min-width:0;display:flex;flex-direction:column;gap:.55em}
.sq-it .n{font-size:.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-it .s{font-size:.34em;letter-spacing:.08em;color:#7d8a82;display:flex;align-items:center;gap:.6em}
.sq-it .s i{width:.9em;height:.9em;background:#56635b;display:inline-block}
.sq-it .s.on i{background:#00ff66}.sq-it .s.party i{background:#4d9bff}.sq-it .s.wait i{background:#ffb347}.sq-it .s.wait{color:#ffb347}.sq-it .s.game i{background:#ff4d4d}.sq-it .s.game{color:#ff6a6a}
.sq-it .a{display:flex;gap:.5em;flex:none}
.sq-h{font-size:.4em;color:var(--ac,#00ff88);letter-spacing:.14em;text-align:left;width:100%}
.sq-bd{background:#e5302f;color:#fff;font-family:'Press Start 2P',monospace;font-size:.7em;padding:.3em .45em .2em;box-shadow:0 0 0 .15em #000;margin-left:.5em}
.sq-chat{width:100%;height:7.5em;overflow:auto;background:rgba(0,0,0,.35);border:.07em solid rgba(255,255,255,.08);padding:.6em .8em;display:flex;flex-direction:column;gap:.5em;text-align:left}
.sq-chat div{font-family:'VT323',monospace;font-size:1.05em;line-height:1.15;color:#cfd8d3;word-break:break-word}
.sq-chat div b{color:var(--ac,#00ff88);font-weight:400}
.sq-chat div.me b{color:#ffd23a}
.sq-emo{display:flex;flex-wrap:wrap;gap:.25em;width:100%;justify-content:center}
.sq-emo button{font-size:1em;line-height:1;padding:.2em .25em;background:rgba(0,0,0,.35);border:.07em solid rgba(255,255,255,.1);cursor:pointer;font-family:sans-serif}
.sq-pcp{position:fixed;inset:0;z-index:120;background:rgba(3,6,4,.88);display:none;align-items:center;justify-content:center}
.sq-pcp.open{display:flex}
.sq-pcp .sq-box{position:relative;width:min(48em,94vw);max-height:94vh;overflow:auto;font-size:16px;padding:1.6em 1.4em 1.2em;background:#0b120e;border:.2em solid var(--ac,#00ff88);box-shadow:0 0 0 .2em #000,.4em .4em 0 .2em rgba(0,0,0,.6),0 0 2em rgba(0,255,136,.25)}
.sq-pcp .sq-x{position:absolute;right:.5em;top:.4em;font-family:'Russo One',sans-serif;font-size:.7em;letter-spacing:.1em;padding:.4em .8em;border:.14em solid #2c3630;color:#9fb0a6;background:none;cursor:pointer}
#sqFound{position:absolute;inset:0;z-index:300;pointer-events:auto;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(3,6,4,.82);font-family:'Press Start 2P',monospace;color:#fff;text-align:center}
#sqFound.show{display:flex}
#sqFound .a{font-size:22px;color:#ffd23a;text-shadow:3px 3px 0 #000,0 0 18px #ffd23a}
.lu{display:flex;align-items:center;gap:26px;margin:4px 0}
.lu .side{display:flex;gap:16px}
.lu .p{display:flex;flex-direction:column;align-items:center;gap:7px;width:84px}
.lu .p .sq-pic{width:58px;height:58px;font-size:22px}
.lu .p .nm{font-size:8px;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:1px 1px 0 #000}
.lu .side.me .nm{color:#3fa0ff}.lu .side.foe .nm{color:#ff6a5a}
.lu .vs{font-size:20px;color:#ffd23a;text-shadow:3px 3px 0 #000}
#sqFound .b{font-size:12px;color:#9bbfff}
/* barras de companeros a la izquierda, como el grupo del WoW: foto, nombre y barra de masa (contra su maximo) */
#sqHud{position:absolute;left:8px;top:64px;z-index:56;display:none;width:118px;font-family:'Press Start 2P',monospace;font-size:7px;line-height:1.4;pointer-events:none;text-shadow:1px 1px 0 #000}
#sqHud.show{display:block}
#sqHud .h{color:#8aa096;margin-bottom:4px;font-size:6px}
#sqHud .pot{background:rgba(6,10,8,.7);border-left:3px solid #ffd23a;padding:4px 5px;margin-bottom:6px;color:#ffd23a;line-height:1.7}#sqHud .pot span{color:#e8e8e8}
#sqHud .pf{display:flex;align-items:center;gap:5px;background:rgba(6,10,8,.6);border-left:3px solid #3fa0ff;padding:3px 5px;margin-bottom:4px}
#sqHud .pf .sq-pic{width:20px;height:20px;font-size:8px}
#sqHud .pf .w{flex:1;min-width:0}
#sqHud .pf .n{color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
#sqHud .pf .bar{height:7px;background:#1a2620;box-shadow:0 0 0 1px #000}
#sqHud .pf .bar i{display:block;height:100%;width:100%;background:#3fa0ff;transition:width .25s}
#sqHud .pf.dead{border-left-color:#555}#sqHud .pf.dead .n{color:#777;text-decoration:line-through}#sqHud .pf.dead .bar i{width:0!important}
#sqToast{position:absolute;left:26px;bottom:22px;z-index:310;display:flex;flex-direction:column;gap:8px;max-width:min(330px,92vw);font-family:'Press Start 2P',monospace}
#sqRc{position:absolute;inset:0;z-index:305;pointer-events:auto;display:none;align-items:center;justify-content:center;background:rgba(3,6,4,.7)}
#sqRc.show{display:flex}
#sqRc .bx{font-family:'Press Start 2P',monospace;color:#fff;text-align:center;background:rgba(8,12,10,.97);border:3px solid #ffd23a;box-shadow:0 0 18px rgba(255,210,58,.4),4px 4px 0 rgba(0,0,0,.6);padding:18px 24px;display:flex;flex-direction:column;gap:14px;align-items:center;max-width:90%}
#sqRc .a{font-size:13px;color:#ffd23a;text-shadow:2px 2px 0 #000}
#sqRc .b{font-size:9px;line-height:1.8;color:#cfd8d3}
#sqRc .r{display:flex;gap:12px}
#sqRc button{font-family:'Russo One',sans-serif;font-size:14px;letter-spacing:2px;padding:9px 22px;border:3px solid #000;background:#2c3630;color:#cfd8d3;cursor:pointer}
#sqRc button.y{background:#00ff88;color:#04150c}
#sqRc.pulse .bx{animation:sqPulse .5s steps(2) 3}
@keyframes sqPulse{50%{box-shadow:0 0 28px rgba(255,210,58,.9),4px 4px 0 rgba(0,0,0,.6)}}
#sqToastC{position:absolute;left:50%;transform:translateX(-50%);bottom:18px;z-index:310;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(420px,92vw);font-family:'Press Start 2P',monospace;pointer-events:none}
#sqToastC .t{text-align:center}
#sqToast .t,#sqToastC .t{pointer-events:auto;background:rgba(8,12,10,.96);border:2px solid #4d9bff;box-shadow:3px 3px 0 rgba(0,0,0,.6),0 0 14px rgba(77,155,255,.35);padding:9px 10px;font-size:8px;line-height:1.7;color:#fff;display:flex;flex-direction:column;gap:7px}
#sqToast .t.w{border-color:#ffd23a;box-shadow:3px 3px 0 rgba(0,0,0,.6),0 0 14px rgba(255,210,58,.3)}
#sqToast .t .r{display:flex;gap:6px;align-items:center}
#sqToast .t img{width:22px;height:22px;border-radius:50%;object-fit:cover}
#sqToast .t button{font-family:'Russo One',sans-serif;font-size:10px;letter-spacing:1px;padding:4px 10px;border:2px solid #2c3630;background:none;color:#9fb0a6;cursor:pointer}
#sqToast .t button.y{background:#00ff88;border-color:#00ff88;color:#04150c}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    // ---------------- identidad (cuenta del airdrop: wallet o X) ----------------
    async function loadIdentity(force) {
        if (!force && Date.now() - S.idAt < 10 * 60 * 1000 && S.x !== 'unknown') return;
        try {
            const j = await (await fetch('/api/airdrop/social-token', { cache: 'no-store' })).json();
            if (j && j.linked) { S.x = 'linked'; S.token = j.token; S.prof = j.me; }
            else { S.x = 'nosession'; S.token = null; S.prof = null; }
            S.idAt = Date.now();
        } catch (e) { /* sin red: se reintenta al abrir */ }
    }

    // ---------------- conexion ----------------
    async function hostUrl() {
        const qs = new URLSearchParams(location.search).get('server');
        let saved = null; try { saved = localStorage.getItem('pw_server'); } catch (e) {}
        const url = qs || saved || (location.protocol === 'https:' ? 'wss://' + location.host : 'ws://localhost:8080');
        try {
            const u = new URL(url), isWss = url.startsWith('wss://');
            const mj = await (await fetch((isWss ? 'https://' : 'http://') + u.host + '/match?mode=squad&price=Free', { cache: 'no-store' })).json();
            if (mj && mj.ok) {
                if (isWss && mj.path) return 'wss://' + u.host + mj.path + '/';
                if (!isWss && mj.port && String(mj.port) !== (u.port || '80')) return 'ws://' + u.hostname + ':' + mj.port;
            }
        } catch (e) {}
        return url;
    }
    function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(Object.assign({ t: 'sq' }, o))); }
    function myName() {
        const el = document.getElementById('playerNameInput');
        let n = (el && el.value || '').trim();
        if (!n) { try { n = localStorage.getItem('pw_app_name') || localStorage.getItem('pw_sq_name') || ''; } catch (e) {} }
        return (n || 'PLAYER').slice(0, 16);
    }
    // El icono del menu del jugador: lo ven sus amigos cuando no tiene foto de X.
    function myAv() { try { return window._hubAvatar ? window._hubAvatar() : null; } catch (e) { return null; } }
    // noPic: con un icono elegido en el perfil, tu foto de X no se ensena (sale el icono).
    const noPic = () => { try { return !!localStorage.getItem('pw_avatar'); } catch (e) { return false; } };
    function refreshAv() { if (S.token) send({ a: 'hello', token: S.token, av: myAv(), name: myName(), noPic: noPic() }); }
    function connect(then) {
        if (S.ws && S.ws.readyState === 1) { then && then(); return; }
        if (then) S.after = then;   // si ya se esta conectando, se ejecuta al abrir
        if (S.conn === 'connecting') return;
        S.conn = 'connecting'; S.err = ''; render();
        loadIdentity().then(hostUrl).then(url => {
            const ws = new WebSocket(url);
            S.ws = ws;
            ws.onopen = () => {
                S.conn = 'open'; S.retry = 0;
                if (S.token) send({ a: 'hello', token: S.token, av: myAv(), name: myName(), noPic: noPic() });   // antes que cualquier otra orden
                render(); const f = S.after; S.after = null; f && f();
            };
            ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
            ws.onclose = () => {
                if (S.ws !== ws) return;
                S.ws = null; S.conn = 'idle';
                if (S.party) { S.party = null; S.err = 'Connection lost.'; }
                render();
                // Si hay cuenta, se reconecta sola (el movil corta los sockets al dormir) para no perder amigos ni invitaciones.
                if (S.token) { S.retry = (S.retry || 0) + 1; setTimeout(() => { if (!S.ws && S.conn === 'idle') connect(() => send({ a: 'friends' })); }, Math.min(30000, 1500 * Math.pow(2, S.retry - 1))); }
            };
            ws.onerror = () => { if (S.conn === 'connecting') { S.conn = 'idle'; S.after = null; S.err = "Couldn't reach the server. Try again."; render(); } };
        });
    }
    setInterval(() => { if (S.ws && S.ws.readyState === 1) S.ws.send('{"t":"ping","ts":' + Date.now() + '}'); }, 25000);
    // Invitaciones a grupo pendientes: se acumulan aqui (10 min) aunque no salga el aviso, y se ven en FRIENDS.
    const liveInvites = () => (S.invites = S.invites.filter(i => Date.now() - i.ts < 600000));
    const dropInvite = id => { S.invites = S.invites.filter(i => i.from.id !== id); render(); };
    function badgeCount() { return S.friends.inReq.length + liveInvites().length + Object.values(S.unread).reduce((a, b) => a + b, 0); }
    function onMsg(m) {
        if (m.t === 'sqParty') { if (m.members.length >= 2 && !(S.party && S.party.members.length >= 2)) S.frTab = 'group'; S.party = m; S.me = m.me; S.err = ''; if (!m.rc && !(m.cm && !m.cm.ready[m.me])) hideRc(); rivalsBanner(); render(); }
        else if (m.t === 'sqGone') { S.party = null; S.err = ''; render(); }
        else if (m.t === 'sqErr') { if (S.joining) { S.joining = false; clearTimeout(S.joinT); } if (m.reason === 'slow_down') return; S.paying = false; S.err = (ERRS[m.reason] || 'Something went wrong.') + (m.reason === 'pay_failed' && m.detail ? ' (' + m.detail + ')' : ''); S.note = ''; render(); }   // pulsar dos veces no es un error que haya que contar
        else if (m.t === 'sqTicket') onTicket(m);
        else if (m.t === 'sqMe') { S.prof = m.me; }
        else if (m.t === 'sqFriends') { S.friends = { friends: m.friends, inReq: m.inReq, outReq: m.outReq }; S.note = ''; render(); }
        else if (m.t === 'sqPresence') { const f = S.friends.friends.find(x => x.id === m.id); if (f) { const antes = f.q; f.st = m.st; f.q = m.q || null; if (f.q && !antes && S.watch[f.id]) avisoListo(f); render(); } }
        else if (m.t === 'sqRooms') { S.rooms = m.rooms; render(); }
        else if (m.t === 'sqInvited') { S.note = 'Invite sent!'; S.err = ''; render(); }
        else if (m.t === 'sqFriendReq') { if (!S.mute.all) toast({ kind: 'friend', pic: m.from.p, text: esc(nameOf(m.from)) + ' wants to be your friend', warm: true, actions: [['ACCEPT', () => send({ a: 'faccept', id: m.from.id }), 1], ['LATER', null]] }); render(); }
        else if (m.t === 'sqInvite') onInvite(m);
        else if (m.t === 'sqReadyCheck') onReadyCheck(m);
        else if (m.t === 'sqRivals') { S.rivals = m.list || []; S.pillUsd = m.pillUsd || 0; S.quote = m.quote || []; render(); }
        else if (m.t === 'sqPropose') onPropose(m);
        else if (m.t === 'squadPrize') onPrize(m);
        else if (m.t === 'sqClaim') onClaim(m);
        else if (m.t === 'sqClaims') { const cb = S.onClaims; S.onClaims = null; if (cb) cb(m.total | 0, m.list || [], m.usd, m.hist || []); }
        else if (m.t === 'sqReadyEnd') { hideRc(); if (m.why && m.why !== 'Cancelled') toast({ text: esc(m.why), warm: true, ms: 6000 }); }   // 'Cancelled' a secas no se avisa: la pantalla ya lo muestra
        else if (m.t === 'sqWhisper') onWhisper(m);
    }

    // ---------------- avisos ----------------
    // Marco girado (ver CSS): ahi viven los carteles que no cuelgan del hub.
    function frame() {
        let f = document.getElementById('sqFrame');
        if (!f) { f = document.createElement('div'); f.id = 'sqFrame'; document.body.appendChild(f); }
        return f;
    }
    function toast(o) {
        // Con el menu a la vista, los avisos sin botones van a la placa SYSTEM del hub (cola, un aviso a la vez).
        if (window.PWSys && document.body.classList.contains('hub-on') && (o.kind || (!o.actions && !o.pic))) {
            const d = document.createElement('div'); d.innerHTML = o.text;
            window.PWSys.push(d.textContent, 12000, o.kind ? 0 : 1, { kind: o.kind || 'arena', pic: o.pic, actions: o.actions }); snd('alert'); return;
        }
        const bid = (o.center || (!o.actions && !o.pic)) ? 'sqToastC' : 'sqToast';   // los avisos sin botones (CANCELLED, premios...) van centrados; susurros e invitaciones a la izquierda
        let box = document.getElementById(bid);
        if (!box) { box = document.createElement('div'); box.id = bid; frame().appendChild(box); }
        const el = document.createElement('div'); el.className = 't' + (o.warm ? ' w' : '');
        el.innerHTML = '<div class="r">' + (o.pic ? '<img src="' + esc(o.pic) + '" alt="" referrerpolicy="no-referrer">' : '') + '<div>' + o.text + '</div></div>' + (o.actions ? '<div class="r">' + o.actions.map((a, i) => '<button data-i="' + i + '" class="' + (a[2] ? 'y' : '') + '">' + a[0] + '</button>').join('') + '</div>' : '');
        const kill = () => { clearTimeout(tm); el.remove(); };
        const tm = setTimeout(kill, o.ms || 14000);
        el.querySelectorAll('button').forEach(b => b.onclick = () => { const a = o.actions[+b.dataset.i]; kill(); if (a[1]) a[1](); });
        el.querySelectorAll('img').forEach(im => { im.onerror = () => im.remove(); });
        box.appendChild(el); snd('alert');
        while (box.children.length > 3) box.firstChild.remove();
    }
    // TRY AGAIN tras morir en la practica: se pide otra entrada a la misma sala si el grupo sigue buscando.
    function practiceAgain() {
        if (S.party && S.party.state === 'queued' && S.ws && S.ws.readyState === 1) { window._sqAgain = true; send({ a: 'practice' }); return true; }
        return false;
    }
    // Cartel de LISTO para los companeros: el lider ha pulsado buscar o unirse y hay que confirmar.
    function hideRc() { const el = document.getElementById('sqRc'); if (el) el.classList.remove('show'); clearInterval(S.rcTimer); }
    // Arena de pago: al dar LISTO se firma la entrada y se cobra del saldo del juego (index.html: pwArenaPay).
    async function readyPay(fee, cents) {
        if (!(fee > 0)) { send({ a: 'ready', v: true }); return; }
        if (S.paying || typeof window.pwArenaPay !== 'function') return;
        S.paying = true; render();
        let pay = null;
        try { pay = await window.pwArenaPay(fee, cents); } catch (e) {}
        S.paying = false;
        if (pay) send({ a: 'ready', v: true, pay });
        render();
    }
    // Abre el panel de ARENAS (la sala de espera del grupo, donde se da READY).
    function abreSala() {
        if (S.arStep) S.arStep.view = null;
        const b = document.querySelector('#appHub [data-a="arenas"]');
        if (b && !isOpen('rooms')) b.click(); else if (!b) openPc('rooms');
        render();
    }
    function rcPopup(title, body, yes, no, onYes) {
        if (typeof window.pwConfirm === 'function') { hideRc(); window.pwConfirm(title, body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''), yes, no, onYes); return; }   // sin sonido
        let el = document.getElementById('sqRc');
        if (!el) { el = document.createElement('div'); el.id = 'sqRc'; el.innerHTML = '<div class="bx"><div class="a"></div><div class="b"></div><div class="r"><button class="y" data-v="1"></button><button data-v="0"></button></div></div>'; frame().appendChild(el); }
        el.querySelector('.a').textContent = title;
        el.querySelector('.b').innerHTML = body;
        el.querySelector('.y').textContent = yes; el.querySelector('[data-v="0"]').textContent = no;
        el.querySelectorAll('button').forEach(b => b.onclick = () => { hideRc(); if (b.dataset.v === '1') onYes(); });
        el.classList.add('show'); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
        snd('alert');
    }
    // El lider ha abierto la sala de espera (o pulsa READY ALL): a los demas les sale PAY & READY. Al lider no (lo tiene en el panel).
    function onReadyCheck(m) {
        if (m.you) return;
        const paid = m.fee > 0;
        rcPopup(String(m.leader).toUpperCase() + ' WANTS TO PLAY', (m.kind === 'custom' ? 'Custom match' : 'Quick match') + ' · ' + m.size + 'V' + m.size + ' · ' + (paid ? (m.usd != null ? fmtUsd(m.usd) + ' · ' : '') + fmtPill(m.fee) + ' each.' : 'free.'),
            'ACCEPT', 'LATER', abreSala);
    }
    function joinInvite(m) {
        const P = S.party;
        if (P && (P.state === 'queued' || P.rc)) { const c = P.rc ? P.rc.cents : P.cents; rcPopup("YOU'RE SEARCHING", 'Your ' + (c ? '$' + c / 100 : 'free') + ' match queue will be cancelled to join ' + nameOf(m.from) + "'s group.", 'JOIN', 'NO', () => joinCode(m.code)); }
        else joinCode(m.code);
    }
    function onInvite(m) {
        S.invites = S.invites.filter(i => i.from.id !== m.from.id); S.invites.push({ from: m.from, code: m.code, ts: Date.now() });
        // Silenciado (todos o este amigo): no sale el aviso; la invitacion espera en FRIENDS.
        if (!(S.mute.all || S.mute.ids[m.from.id])) toast({
            kind: 'invite', pic: m.from.p, warm: true, ms: 12000, text: esc(nameOf(m.from)) + ' invites you to a group',
            actions: [['JOIN', () => { dropInvite(m.from.id); joinInvite(m); }, 1], ['NO', () => dropInvite(m.from.id)]],
        });
        render();
    }
    function joinCode(code) {
        if (S.party) { send({ a: 'leave' }); S.party = null; }
        openFriends();
        connect(() => send({ a: 'join', code, name: myName() }));
    }
    function onWhisper(m) {
        const other = m.mine ? m.to : m.from;
        const list = S.chat[other.id] || (S.chat[other.id] = []);
        list.push({ me: !!m.mine, text: m.text, ts: m.ts }); if (list.length > 40) list.shift();
        if (!m.mine) {
            const viewing = S.chatWith === other.id && isOpen('friends');
            if (!viewing) {
                S.unread[other.id] = (S.unread[other.id] || 0) + 1;
                // Silenciado (todos o este amigo): no sale el popup; el WHISPER sigue parpadeando con el mensaje sin leer.
                if (!(S.mute.all || S.mute.ids[other.id])) toast({ kind: 'whisper', pic: other.p, text: esc(friendName(other)) + ': ' + esc(m.text.slice(0, 80)), actions: [['REPLY', () => { S.chatWith = other.id; S.unread[other.id] = 0; openFriends(); }, 1], ['X', null]], ms: 9000 });
            }
        }
        render();
        const c = S.box.friends && S.box.friends.querySelector('.sq-chat'); if (c) c.scrollTop = 0;
    }

    // ---------------- entrada a sala ----------------
    function enter(ticket, kind, mode) {
        if (S.enterBusy) return;
        S.enterBusy = true; setTimeout(() => { S.enterBusy = false; }, 2500);
        if (kind !== 'practice') closeAll();   // en la practica las ventanas se quedan hasta que la partida ya se ve (no se cierran y luego sale el juego)
        if (typeof window.pwSquadEnter === 'function') window.pwSquadEnter(ticket, kind, mode);
    }
    function onTicket(m) {
        // REJOIN: vuelves a TU partida (ya habias muerto): se entra directo a mirar con tu equipo, sin VS.
        window._sqSince = m.since != null ? { ms: m.since, at: performance.now() } : null;   // la musica sigue por donde va la sala
        if (m.rejoin) { S.lineupData = null; enter(m.ticket, 'rejoin', m.mode); return; }
        // Te saliste con tu pildora viva: vuelves a llevarla (se quedo en el mapa sin moverse).
        if (m.resume) { S.lineupData = null; enter(m.ticket, 'resume', m.mode); return; }
        if (m.kind === 'practice') {
            S.lineup = null; S.lineupData = null;
            // El jugador pidio practicar mientras espera. Si ya hay una partida de equipo en curso no se pisa.
            if (window.pwSquadActive && window.pwSquadActive() === 'match') return;
            enter(m.ticket, 'practice', m.mode);
            return;
        }
        // Rival encontrado: aviso con cuenta atras y entrada automatica.
        let n = 5;
        const el = foundEl();
        const paint = () => { el.querySelector('.b').textContent = 'ENTERING IN ' + n + '…'; };
        el.querySelector('.a').textContent = 'RIVAL FOUND!';
        // Fotos de tu equipo VS fotos del rival, con su nombre de X o de wallet: asi sabes con quien juegas.
        const side = (list, cls) => '<div class="side ' + cls + '">' + (list || []).map(x => '<div class="p">' + pic({ p: x.pic, av: x.av, n: x.name }) + '<span class="nm">' + esc(x.name) + '</span></div>').join('') + '</div>';
        const mine = m.team === 'B' ? 'B' : 'A', other = mine === 'A' ? 'B' : 'A';
        S.lineupData = m.lineup ? { me: m.lineup[mine], foe: m.lineup[other], fee: m.fee | 0, usd: m.usd } : null; S.lastSize = m.size;
        S.lineup = m.lineup ? '<div class="lu">' + side(m.lineup[mine], 'me') + '<span class="vs">VS</span>' + side(m.lineup[other], 'foe') + '</div>' : null;
        el.querySelector('.c').innerHTML = m.lineup
            ? '<div class="lu">' + side(m.lineup[mine], 'me') + '<span class="vs">VS</span>' + side(m.lineup[other], 'foe') + '</div>'
            : esc(m.size + 'V' + m.size + ' · TEAM ' + m.team);
        hydrate(el);
        el.classList.add('show'); paint(); snd('alert');
        clearInterval(S.ticketTimer);
        S.ticketTimer = setInterval(() => {
            n--;
            if (n > 0) { paint(); return; }
            clearInterval(S.ticketTimer); S.ticketTimer = null;
            el.classList.remove('show');
            S.enterBusy = false;
            enter(m.ticket, 'match', m.mode);
        }, 1000);
    }
    function foundEl() {
        let el = document.getElementById('sqFound');
        if (!el) { el = document.createElement('div'); el.id = 'sqFound'; el.innerHTML = '<div class="a"></div><div class="c b"></div><div class="b"></div>'; frame().appendChild(el); }
        return el;
    }

    // ---------------- dentro de la partida ----------------
    function hud() {
        let el = document.getElementById('sqHud');
        if (!el) { el = document.createElement('div'); el.id = 'sqHud'; frame().appendChild(el); }
        return el;
    }
    // Posiciones de companeros que manda el servidor (4 por segundo): el juego las marca en el borde si no se ven.
    // En la practica, mientras el grupo busca rival, sale el cartel azul de FINDING ROOM pero con RIVALS (y nada mas).
    let rivT = null, rivN = 0;
    function rivalsBanner() {
        const on = !!(S.party && S.party.state === 'queued' && S.roster && S.roster.practice && S.rel);
        if (on && !rivT) {
            rivN = 0;
            const put = () => { if (typeof window.setLobbyBanner === 'function') window.setLobbyBanner('FINDING RIVALS' + '.'.repeat((rivN++ % 3) + 1), 'search'); };
            put(); rivT = setInterval(put, 400);
        } else if (!on && rivT) { clearInterval(rivT); rivT = null; if (typeof window.setLobbyBanner === 'function') window.setLobbyBanner(null); }
    }
    function onAllies(m) {
        S.allies = { t: Date.now(), a: m.a || [], tg: m.tg || null };
        const el = document.getElementById('sqHud');
        for (const f of m.f || []) {
            const row = el && el.querySelector('.pf[data-id="' + f.id + '"]'); if (!row) continue;
            row._pk = Math.max(row._pk || 0, f.m);
            row.classList.toggle('dead', !f.m);
            row.querySelector('.bar i').style.width = (row._pk ? Math.round(100 * f.m / row._pk) : 100) + '%';
        }
    }
    function onRoster(m) {
        if (!S.roster || S.roster.myId !== m.myId) { S.prize = null; S.endMoney = null; }
        S.roster = m; S.allies = null; setTimeout(rivalsBanner, 0);
        S.rel = new Map();
        const mine = m.me === 'A' ? 'A' : 'B', other = mine === 'A' ? 'B' : 'A';
        for (const p of m.teams[mine]) S.rel.set(p.id, 'ally');
        for (const p of m.teams[other]) S.rel.set(p.id, 'foe');
        const el = hud(), me = m.myId;
        const mates = m.teams[mine].filter(p => p.id !== me);
        el.innerHTML = (m.practice && mates.length ? '<div class="h">PRACTICE</div>' : '') + mates.map(p =>
            '<div class="pf" data-id="' + esc(p.id) + '">' + pic({ p: p.pic, av: p.av, n: p.name }) + '<div class="w"><div class="n">' + esc(p.name || 'PLAYER') + '</div><div class="bar"><i></i></div></div></div>').join('');
        hydrate(el);
        el.classList.toggle('show', mates.length > 0);   // en 1v1 no hay companeros: nada a la izquierda
    }
    // Tamano base en pixeles ENTEROS y pares: con decimales la letra pixel se veia borrosa (sobre todo en PC).
    function nitido(el) {
        const M = Math.max(innerWidth, innerHeight), m = Math.min(innerWidth, innerHeight);
        el.style.fontSize = Math.max(10, 2 * Math.round(Math.min(M * 0.0125, m * 0.027) / 2)) + 'px';
    }
    addEventListener('resize', () => document.querySelectorAll('#sqEnd,.ci').forEach(nitido));
    // Pildoras de fondo como en el diseno: confeti de colores arriba en la victoria, grises "comidas" abajo en la derrota,
    // unas pocas amarillas en el empate. Con los sprites del juego y siempre en diagonal.
    function fondoFin(el, tipo) {
        const cv = el.querySelector('canvas.fx'), spr = window.pwPillSprite; if (!cv || !spr) return;
        const W = cv.width = Math.round(el.clientWidth / 2), H = cv.height = Math.round(el.clientHeight / 2);
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        const COL = ['#ff4d6d', '#1d9bf0', '#ffce3d', '#b86bff', '#00ff88', '#ff8a3d', '#ccff00', '#ff5fd2'];
        const n = tipo === 'win' ? 64 : tipo === 'lose' ? 70 : 10, pills = [];
        // Zona sin pildoras alrededor de VICTORY / DEFEAT: la caja del texto a su tamaño final (la animacion de entrada lo escala) mas un margen,
        // y fuera de ella la densidad sube poco a poco hasta la normal para que el corte no sea brusco.
        const tt = el.querySelector('.t'), an = tt ? tt.style.animation : '';
        if (tt) tt.style.animation = 'none';
        let tb = { left: 0, right: 0, top: 0, bottom: 0 };
        if (tt) { const rg = document.createRange(); rg.selectNodeContents(tt); tb = rg.getBoundingClientRect(); tt.style.animation = an; }
        const er = el.getBoundingClientRect(), kx = W / (er.width || 1), ky = H / (er.height || 1), M = 14;
        const zx0 = (tb.left - er.left - M) * kx, zx1 = (tb.right - er.left + M) * kx, zy0 = (tb.top - er.top - M) * ky, zy1 = (tb.bottom - er.top + M) * ky;
        const RAMP = 260 * kx;   // a esta distancia del titulo la densidad ya es la normal
        const enZona = (x, y) => x > zx0 && x < zx1 && y > zy0 && y < zy1;
        const dist = (x, y) => Math.hypot(Math.max(zx0 - x, 0, x - zx1), Math.max(zy0 - y, 0, y - zy1));
        // la franja oscura tapa el lienzo: 3 de cada 4 se colocan fuera de ella para que se vean
        const enBanda = (x, y) => { const X = x / kx, Y = y / ky, top = er.height * .27 + (er.width / 2 - X) * 0.0699; return Y > top - 8 && Y < top + er.height * .62; };
        const lugar = i => {
            for (let t = 0; t < 400; t++) {
                const x = Math.random() * W, y = Math.random() * H;
                if (enZona(x, y) || Math.random() > Math.min(1, dist(x, y) / RAMP) || (enBanda(x, y) && i % 4)) continue;
                return [x, y];
            }
            return [Math.random() * W, H * .92];
        };
        for (let i = 0; i < n; i++) {
            const top = tipo === 'win' ? '#ffffff' : tipo === 'draw' ? '#fff3c4' : '#f4f4f4';
            const bot = tipo === 'win' ? COL[i % COL.length] : tipo === 'draw' ? '#ffd23a' : '#3a3a3a';
            const o = spr(6, top, bot, -Math.PI / 4, true), q = { c: o.cv || o, ph: Math.random() * 6.28 };
            if (tipo === 'win') {
                // VICTORIA: confeti repartido por los lados; frena y cae
                const a = Math.random() * 6.28, v = 60 + Math.random() * 160;
                [q.x, q.y] = lugar(i); q.vx = Math.cos(a) * v; q.vy = Math.sin(a) * v - 60; q.dl = Math.random() * 400;
            } else if (tipo === 'lose') {
                // DERROTA: caen despacio por toda la pantalla (menos por el titulo)
                [q.x, q.y] = lugar(i); q.vy = 4 + Math.random() * 6;
            } else { q.x = 8 + (Math.random() < .5 ? Math.random() * .22 : .78 + Math.random() * .22) * (W - 16); q.y = 6 + Math.random() * H * 0.2; }
            pills.push(q);
        }
        cancelAnimationFrame(S.fxRaf);
        const t0 = performance.now(); let tAnt = t0;
        cv.style.zIndex = '0';   // el confeti pasa por detras de la banda negra (jugadores y texto se leen limpios)
        const paso = t => {
            if (!el.classList.contains('show')) return;
            const dt = Math.min(0.05, (t - tAnt) / 1000); tAnt = t;
            g.clearRect(0, 0, W, H);
            for (const q of pills) {
                let x, y;
                if (tipo === 'win') {
                    if (t - t0 < q.dl) continue;
                    q.vx *= Math.pow(0.35, dt); q.vy = q.vy * Math.pow(0.35, dt) + 90 * dt;   // aire y gravedad
                    q.x += q.vx * dt; q.y += q.vy * dt;
                    if (q.y > H + 10) { q.y = -10; q.x = Math.random() * W; q.vx = (Math.random() - .5) * 20; q.vy = 10 + Math.random() * 15; }   // luego sigue cayendo confeti suave
                    x = q.x + Math.sin(t / 300 + q.ph) * 3; y = q.y;
                }
                else if (tipo === 'lose') { q.y += q.vy * dt; if (q.y > H + 10) { q.y = -10; q.x = Math.random() * W; } x = q.x + Math.sin(t / 900 + q.ph) * 2; y = q.y; }
                else { x = q.x; y = q.y + Math.sin(t / 700 + q.ph) * 2; }
                if (tipo !== 'draw' && enZona(x, y)) continue;   // nunca se pinta una pildora sobre el titulo
                g.drawImage(q.c, Math.round(x - q.c.width / 2), Math.round(y - q.c.height / 2));
            }
            S.fxRaf = requestAnimationFrame(paso);
        };
        S.fxRaf = requestAnimationFrame(paso);
    }
    function onEnd(m) {
        hud().classList.remove('show');
        S.rel = null; S.allies = null; rivalsBanner();
        if (m.practice) {
            // La practica acabo: si el grupo sigue buscando, se vuelve a ofrecer sin meter a nadie a la fuerza.
            return;
        }
        // Se deja ver (y leer) el aviso de la ultima muerte antes de pasar al cartel, con un fundido; antes salia de golpe.
        clearTimeout(S.endT);
        S.endT = setTimeout(() => mostrarFin(m), 1000);   // el aviso de la ultima muerte se ve 3 s en pantalla y sigue visible un poco con el fundido
    }
    // Premio del equipo ganador: llega aparte (squadPrize) y se cobra con una firma (CLAIM) al saldo del juego.
    function onPrize(m) {
        if (S.prize && S.prize.id === m.id) return;
        S.prize = { id: m.id, amount: m.amount, usd: m.usd, claimed: false };
        const el = document.getElementById('sqEnd'); if (el && el.classList.contains('show')) pintaPremio(el);
    }
    function prizes(wallet, cb) { if (!wallet) return cb(0, []); S.onClaims = cb; connect(() => send({ a: 'claims', wallet })); }
    async function claimAll(after) {
        if (S.claiming || typeof window.pwArenaClaimAll !== 'function') return;
        S.claiming = true; S.afterAll = after || null;
        let sig = null; try { sig = await window.pwArenaClaimAll(); } catch (e) {}
        if (!sig) { S.claiming = false; return; }
        connect(() => send(Object.assign({ a: 'claimall' }, sig)));
    }
    function onClaim(m) {
        S.claiming = false;
        if (m.all) {
            if (m.ok) { if (S.prize) S.prize.claimed = true; toast({ text: '+' + fmtPill(m.amount) + ' added to your balance', warm: true, ms: 5000, center: true }); }
            else if (m.reason !== 'already_claimed') toast({ text: 'Claim failed. Try again.', warm: true, ms: 4000, center: true });
            const cb = S.afterAll; S.afterAll = null; if (cb) cb();
            const el0 = document.getElementById('sqEnd'); if (el0) pintaPremio(el0);
            try { if (window.GameWallet && GameWallet.refreshBalance) GameWallet.refreshBalance(); } catch (e) {}
            return;
        }
        if (m.ok) { if (S.prize && S.prize.id === m.id) S.prize.claimed = true; toast({ text: '+' + fmtPill(m.amount) + ' added to your balance', warm: true, ms: 5000, center: true }); }
        else if (m.reason === 'already_claimed') { if (S.prize && S.prize.id === m.id) S.prize.claimed = true; }
        else toast({ text: 'Claim failed. Try again.', warm: true, ms: 4000, center: true });
        const el = document.getElementById('sqEnd'); if (el) pintaPremio(el);
        try { if (window.GameWallet && GameWallet.refreshBalance) GameWallet.refreshBalance(); } catch (e) {}
    }
    async function claimPrize() {
        const pz = S.prize; if (!pz || pz.claimed || S.claiming || typeof window.pwArenaClaim !== 'function') return;
        S.claiming = true; const el = document.getElementById('sqEnd'); if (el) pintaPremio(el);
        let sig = null; try { sig = await window.pwArenaClaim(pz.id); } catch (e) {}
        if (!sig) { S.claiming = false; if (el) pintaPremio(el); return; }
        connect(() => send(Object.assign({ a: 'claim', id: pz.id }, sig)));
    }
    function pintaPremio(el) {
        // Barra de una linea con pestaña (YOUR PRIZE / TEAM PRIZE, YOU LOST / TEAM LOST, FREE MATCH, DRAW); CLAIM cuelga debajo.
        const box = el.querySelector('.prz'), e = S.endMoney, team = !!(e && e.team), nT = (e && e.nTeam) || 1;
        const barra = (tab, inner, extra) => '<div class="pw"><div class="pbar" data-t="' + tab + '">' + inner + '</div>' + (extra || '') + '</div>';
        const linea = (amt, usd) => '<span class="line"><b class="pa">' + fmtPill(amt) + '</b>' + (usd != null ? '<span class="pu">≈ ' + fmtUsd(usd) + '</span>' : '') + '</span>';
        if (!e) { box.innerHTML = barra('FREE MATCH', '<span class="pf">Next time play a <b>paid match</b> and win their <b>$PILLY</b>.</span>'); return; }
        const mo = e.money;
        if (mo.draw) { box.innerHTML = barra('DRAW', '<span class="pf">Your entry is back in your <b>balance</b>.</span>'); return; }
        if (!e.win) { box.innerHTML = barra(team ? 'TEAM LOST' : 'YOU LOST', linea(mo.pot, mo.usdPot)); return; }
        const tab = team ? 'TEAM PRIZE' : 'YOUR PRIZE', k = team ? nT : 1;   // en equipo se enseña lo que gana el equipo entero; CLAIM cobra tu parte
        const pz = S.prize;
        if (!pz) { box.innerHTML = barra(tab, linea(mo.share * k, mo.usdShare != null ? mo.usdShare * k : null)); return; }
        box.innerHTML = barra(tab, linea(pz.amount * k, pz.usd != null ? pz.usd * k : null),
            '<div class="clr"><button class="cl"' + (pz.claimed || S.claiming ? ' disabled' : '') + '>' + (pz.claimed ? 'CLAIMED' : S.claiming ? 'SIGNING...' : 'CLAIM') + '</button>' +
            (pz.claimed ? '' : '<span class="pl">OR LATER<br>IN PROFILE</span>') + '</div>');
        const b = box.querySelector('.cl'); if (b) b.onclick = () => { snd('simpleselect'); claimPrize(); };
    }
    function mostrarFin(m) {
        // Pantalla de fin (diseno C): banda oscura en diagonal, VICTORY en verde o DEFEAT en rojo, filas con foto, kills y peak.
        let el = document.getElementById('sqEnd');
        if (!el) {
            el = document.createElement('div'); el.id = 'sqEnd';
            el.innerHTML = '<canvas class="fx"></canvas><div class="band"><div class="t"></div><div class="cols"><div class="tms"></div><div class="prz"></div></div></div><div class="bts"><button data-e="again">PLAY AGAIN</button><button data-e="menu" class="o">MENU</button></div>';
            frame().appendChild(el);
            el.querySelector('[data-e="menu"]').onclick = () => { el.classList.remove('show'); try { returnToMenu(); } catch (e) {} };
            // PLAY AGAIN: vuelta a la pantalla del grupo; hay que dar LISTO otra vez.
            el.querySelector('[data-e="again"]').onclick = () => {
                el.classList.remove('show');
                try { returnToMenu(); } catch (e) {}
                setTimeout(() => { S.arStep = S.lastSize ? { size: S.lastSize, view: null } : null; const b = document.querySelector('#appHub [data-a="arenas"]'); if (b) b.click(); else openPc('rooms'); S.arStep = S.lastSize ? { size: S.lastSize, view: null } : null; render(); }, 250);
            };
        }
        const mine = S.roster ? S.roster.me : 'A', other = mine === 'A' ? 'B' : 'A', win = m.winner === mine;
        const nMax = Math.max(((m.players || {}).A || []).length, ((m.players || {}).B || []).length), n3 = nMax >= 3, n2 = nMax === 2;
        el.className = (!m.winner ? 'draw' : win ? 'win' : 'lose') + (n3 ? ' n3' : n2 ? ' n2' : '');   // n3/n2: filas mas bajas para que quepan
        el.querySelector('.t').textContent = !m.winner ? 'DRAW' : win ? 'VICTORY!' : 'DEFEAT';
        const BOT_FEE = 0.10;   // el mismo 10 % de casa que server/arena-pay.js: al comido por un bot se le cobra eso de su entrada
        const mostrado = p => p.byBot ? p.stake - Math.floor(p.stake * BOT_FEE) : p.stake;
        const row = (p, cls) => '<div class="rw ' + cls + '"><span class="ph ' + cls + '">' + pic({ p: p.pic, av: p.av, n: p.name }) + '</span><span class="nm">' + esc(p.name) + '</span>' +
            '<span class="k">' + p.kills + ' KILL' + (p.kills === 1 ? '' : 'S') + '</span><span class="pk' + (p.byBot ? ' bot' : '') + '">' + (m.money && p.stake ? fmtPill(mostrado(p)) : p.peak.toLocaleString('en-US') + ' PEAK') + '</span></div>';   // comido por un bot: tachado en rojo
        const list = (t, cls) => ((m.players && m.players[t]) || []).map(p => row(p, cls)).join('');
        el.querySelector('.tms').innerHTML = '<div><div class="h me">YOUR TEAM</div>' + list(mine, 'me') + '</div><div><div class="h foe">RIVALS</div>' + list(other, 'foe') + '</div>';
        S.endMoney = m.money ? { win, money: m.money, nTeam: ((m.players || {})[mine] || []).length, team: ((m.players || {})[mine] || []).length > 1 } : null;
        pintaPremio(el);
        hydrate(el);
        // El sonido sale cuando la pantalla (la cuadricula roja/verde) ya se esta pintando: al empezar su fundido.
        let sonado = false;
        const sonar = () => { if (sonado) return; sonado = true; setTimeout(() => { if (el.classList.contains('show')) snd(win ? 'finwin' : 'finlose'); }, 120); };
        el.addEventListener('animationstart', sonar, { once: true });
        setTimeout(sonar, 1500);   // por si el navegador no anima (ahorro de energia)
        nitido(el); el.classList.add('show'); fondoFin(el, !m.winner ? 'draw' : win ? 'win' : 'lose');
    }
    // Pantalla de entrada a la partida (diseno C, animada ~4 s): fondo lima, entra la banda azul con tu equipo,
    // golpe del VS y entra la banda roja con los rivales. index.html la mete en #sqEntry.
    function intro() {
        const d = S.lineupData; if (!d) return null;
        const tiles = (list, cls) => list.map((x, i) => '<div class="ti ' + cls + '" style="animation-delay:' + (cls === 'me' ? .45 + i * .15 : 1.75 + i * .15) + 's">' + pic({ p: x.pic, av: x.av, n: x.name }) + '<span class="nm">' + esc(x.name) + '</span></div>').join('');
        const pills = cls => '<div class="pl4 ' + cls + '">' + '<i></i>'.repeat(4) + '</div>';
        const el = document.createElement('div'); el.className = 'ci'; nitido(el);
        el.innerHTML = '<div class="bd ba"><div class="row">' + tiles(d.me, 'me') + '</div>' + pills('pa') + '</div>' +
            '<div class="vs">VS</div>' +
            '<div class="bd bb"><div class="row">' + tiles(d.foe, 'foe') + '</div>' + pills('pb') + '</div>' +
            '<div class="tt">ARENAS · ' + d.me.length + 'V' + d.me.length + '</div>';
        {
            // Siempre a la derecha (en el sitio de las pildoras), igual en 1V1, 2V2 y 3V3; las fotos se centran a la izquierda.
            const n = d.me.length, ancho = '';
            el.classList.add('stk3');
            const linea = k => d.fee > 0 ? fmtK(d.fee * k) + ' $PILLY' + (d.usd != null ? ' <span class="ap">≈</span> ' + fmtUsd(d.usd * k) : '') : 'FREE';
            const stk = (cls, k) => '<div class="stk ' + cls + ' sm' + (d.fee > 0 ? '' : ' free') + '" style="' + ancho + '"><div class="in">' +
                '<div class="sl">' + (cls === 'sk-me' ? (k > 1 ? 'YOUR TEAM' : 'YOU') : (k > 1 ? 'RIVALS' : 'RIVAL')) + '</div><div class="sv">' + linea(k) + '</div></div></div>';
            // Fuera de las franjas (encima, en la misma inclinacion) y con su propia animacion: dentro de la franja de abajo,
            // que entra desde fuera de la pantalla, el WebView del movil no la llegaba a pintar.
            el.insertAdjacentHTML('beforeend', stk('sk-me', d.me.length) + stk('sk-foe', d.foe.length));
            const enciende = (q, ms) => setTimeout(() => { const x = el.querySelector(q); if (x) x.classList.add('on'); }, ms);
            enciende('.stk.sk-me', 600); enciende('.stk.sk-foe', 1600);   // la de los rivales, cuando entra su franja
        }
        hydrate(el);
        // Pildoras pixel (los sprites del juego) en lugar de las de CSS.
        const spr = window.pwPillSprite;
        if (spr) {
            // La sombra va pintada dentro del canvas (con filter: drop-shadow el WebView del movil le ponia un cuadrado detras).
            const dib = (cv, top, bot, r) => {
                const o = spr(r, top, bot, -Math.PI / 4, true), src = o.cv || o;
                cv.width = src.width + 1; cv.height = src.height + 1;
                const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
                g.drawImage(src, 1, 1); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
                g.globalCompositeOperation = 'source-over'; g.drawImage(src, 0, 0);
            };
            el.querySelectorAll('.pl4').forEach(box => box.querySelectorAll('i').forEach(i => { const cv = document.createElement('canvas'); cv.className = 'px'; dib(cv, box.classList.contains('pa') ? '#e8f6ff' : '#ffffff', box.classList.contains('pa') ? '#1d9bf0' : '#ff4d6d', 6); i.replaceWith(cv); }));
        }
        // Si la cifra no cabe en su hueco, la letra baja hasta que cabe (nunca se sale ni pisa las fotos).
        const ajusta = () => { if (!el.isConnected) return requestAnimationFrame(ajusta); el.querySelectorAll('.stk').forEach(b => { const sv = b.querySelector('.sv'); let fs = parseFloat(getComputedStyle(sv).fontSize); while (sv.scrollWidth > b.clientWidth && fs > 7) { fs -= 1; sv.style.fontSize = fs + 'px'; } }); };
        requestAnimationFrame(ajusta);
        // Sonidos que acompanan la animacion (las bandas entran, cada foto aparece, golpe del VS).
        const fx = (n, t, v) => setTimeout(() => { if (el.isConnected) try { SoundManager.playFx(n, v); } catch (e) {} }, t * 1000);
        fx('vswhoosh', .15, .5); d.me.forEach((x, i) => fx('vspop', .45 + i * .15, .35));
        fx('vsslam', 1.2, .7);
        fx('vswhoosh', 1.45, .5); d.foe.forEach((x, i) => fx('vspop', 1.75 + i * .15, .35));
        return el;
    }
    // Dibujo de cada tarjeta 1V1/2V2/3V3: un trozo de mapa (cuadricula y comida) con las pildoras del juego enfrentadas.
    function drawCards(box) {
        const spr = window.pwPillSprite; if (!box || !spr) return;
        box.querySelectorAll('canvas.cvc').forEach(cv => {
            const n = +cv.dataset.n, W = cv.width = 220, H = cv.height = 150, g = cv.getContext('2d');
            g.imageSmoothingEnabled = false;
            g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
            g.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < W; x += 20) g.fillRect(x, 0, 1, H); for (let y = 0; y < H; y += 20) g.fillRect(0, y, W, 1);
            const FOOD = ['#ff4d6d', '#1d9bf0', '#ffce3d', '#b86bff', '#00ff88', '#ff8a3d', '#ccff00', '#2ee6d6'];
            let sd = 11 + n * 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
            for (let i = 0; i < 22; i++) { g.fillStyle = FOOD[i % FOOD.length]; g.fillRect(Math.round(rnd() * W), Math.round(rnd() * H), 3, 3); }
            const tint = g.createLinearGradient(0, 0, W, 0); tint.addColorStop(0, 'rgba(29,155,240,.32)'); tint.addColorStop(.5, 'rgba(0,0,0,0)'); tint.addColorStop(1, 'rgba(255,77,109,.32)');
            g.fillStyle = tint; g.fillRect(0, 0, W, H);
            const sz = n === 1 ? 16 : n === 2 ? 11 : 8, k = 3;
            const pos = n === 1 ? [[58, 75]] : n === 2 ? [[44, 46], [70, 104]] : [[34, 32], [70, 75], [34, 118]];
            const put = (o, x, y) => { const c = o.cv || o; g.drawImage(c, Math.round(x - c.width * k / 2), Math.round(y - c.height * k / 2), c.width * k, c.height * k); };
            pos.forEach(([x, y]) => { put(spr(sz, '#e8f6ff', '#1d9bf0', Math.PI / 4, true), x, y); put(spr(sz, '#ffffff', '#ff4d6d', -Math.PI / 4, true), W - x, y); });
        });
    }

    // ---------------- UI ----------------
    // Foto de X; sin ella, el icono del menu del jugador (se dibuja al pintar, ver hydrate); y si no, su inicial.
    const FALLBACK_AV = { t: 'spook', bg: '#ab9ff2' };
    // Foto de X a 200 px: la _normal (48 px) se veia borrosa en las fotos grandes.
    const bigPic = u => String(u || '').replace(/_normal(\.[a-z]+)$/i, '_200x200$1');
    const pic = o => o.p ? '<img class="sq-pic" src="' + esc(bigPic(o.p)) + '" alt="" referrerpolicy="no-referrer" data-fb="' + esc(JSON.stringify(o.av || FALLBACK_AV)) + '">'
        : (o.av && window._hubAvatarEl ? '<span class="sq-pic" data-av="' + esc(JSON.stringify(o.av)) + '"></span>' : '<span class="sq-pic">' + initial(o) + '</span>');
    const memberO = m => ({ p: m.pic, av: m.av, u: '', n: m.name });
    function hydrate(box) {
        // Si la foto de X no carga, se usa el icono que el jugador eligio en su perfil.
        box.querySelectorAll('img[data-fb]').forEach(im => {
            const fb = () => {
                if (!im.isConnected || !window._hubAvatarEl) return;
                try { const sp = document.createElement('span'); sp.className = 'sq-pic'; sp.appendChild(window._hubAvatarEl(JSON.parse(im.dataset.fb), 96)); im.replaceWith(sp); } catch (e) {}
            };
            if (im.complete && im.naturalWidth === 0) fb(); else im.onerror = fb;
        });
        box.querySelectorAll('[data-av]').forEach(x => {
            try { const el = window._hubAvatarEl(JSON.parse(x.dataset.av), 96); x.removeAttribute('data-av'); x.appendChild(el); } catch (e) { x.removeAttribute('data-av'); }
        });
    }
    const imLeader = () => !S.party || S.party.leader === S.me;
    const groupSize = () => S.party ? S.party.members.length : 1;
    const errLine = () => '<div class="sq-err">' + (S.note ? '<span class="sq-ok">' + esc(S.note) + '</span>' : esc(S.err || '')) + '</div>';

    // El grupo: foto de cada uno con el nombre debajo.
    function groupHtml(withKick, slots, big, small) {
        const p = S.party;
        if (!p) return '';
        const out = [];
        for (let i = 0; i < Math.max(slots || p.members.length, p.members.length); i++) {
            const m = p.members[i];
            if (!m) { out.push('<div class="sq-av empty"><span class="sq-pic">+</span><div class="lb"><div class="n" style="color:#4a5850">EMPTY</div></div></div>'); continue; }
            const rcTag = p.rc ? (p.rc.ready[m.id] ? '<div class="l" style="color:#00ff66">READY</div>' : '<div class="l" style="color:#ffb347">WAITING…</div>') : '';
            out.push('<div class="sq-av' + (m.id === S.me ? ' me' : '') + '">' + pic(memberO(m)) + '<div class="lb"><div class="n">' + esc(m.name) + '</div>' +
                (p.rc ? rcTag : (m.leader ? '<div class="l">LEADER</div>' : (withKick && S.party.leader === S.me && p.state === 'idle' ? '<span class="k" data-k="' + m.id + '">KICK</span>' : ''))) + '</div></div>');
        }
        return '<div class="sq-grp' + (big ? ' big' : '') + (small ? ' small' : '') + '">' + out.join('') + '</div>';
    }

    // ----- panel ARENAS: lista de salas / buscando -----
    const KIND_TXT = { quick: 'QUICK MATCH', room: 'NEW ROOM', join: 'JOINING A ROOM', custom: 'MATCH CUSTOM' };
    // Precio exacto: dolares de verdad (con 2 decimales como mucho), $PILLY de cada uno y el bote de los dos equipos.
    function priceLine(fee, usd, size) {
        if (!(fee > 0)) return '<div class="sq-pl free">FREE MATCH</div>';
        return '<div class="sq-pl">' + (usd != null ? '<b>' + fmtUsd(usd) + '</b> · ' : '') + fmtPill(fee) + ' EACH · POT ' + fmtPill(fee * size * 2) + '</div>';
    }
    // Fila de botones de ancho fijo: el hueco de READY ALL se guarda aunque no salga, para que la ventana no salte.
    const ghost = txt => '<button class="sq-b sq-ghost" tabindex="-1">' + txt + '</button>';
    // Desde la sala de espera o buscando tambien se puede mirar FIND RIVALS (y ahi sales como (YOU)).
    const seeRivals = '<button class="sq-b sm" data-a="seerivals">FIND RIVALS</button>';
    // Lo que hay en juego, al lado del grupo (arriba hacia crecer la ventana).
    function priceBox(fee, usd, size) {
        const body = fee > 0
            ? '<div class="k">ENTRY</div><div class="u">' + (usd != null ? fmtUsd(usd) : '') + '</div><div class="t">' + fmtPill(fee) + ' EACH</div><div class="sep"></div><div class="k">POT</div><div class="t g">' + fmtPill(fee * size * 2) + '</div>'
            : '<div class="u free">FREE</div><div class="t">NO ENTRY</div>';
        return '<div class="sq-pbox">' + body + seeRivals + cercana(size) + '</div>';
    }
    // Otra sala con gente LISTA a un precio distinto del tuyo: la mas cercana en dolares (a igual distancia, la de mas precio).
    function cercana(size) {
        const P = S.party; if (!P || P.custom || (!P.rc && P.state !== 'queued')) return '';
        const mio = P.rc ? P.rc.cents | 0 : P.cents | 0, yo = groupSize(), rv = S.rivals || [];
        // Ya hay gente en tu precio: se dice, sin recomendar otra sala.
        const aqui = rv.find(r => r.size === size && r.cents === mio);
        if (aqui) {
            const ready = aqui.ready - (P.state === 'queued' ? yo : 0), look = aqui.looking - (P.rc ? yo : 0), k = ready > 0 ? ready : look;
            if (k > 0) {
                const g = Math.ceil(k / size), unit = size === 1 ? (k === 1 ? 'PLAYER' : 'PLAYERS') : (g === 1 ? 'GROUP' : 'GROUPS'), n = size === 1 ? k : g;
                return '<div class="sq-wt' + (ready > 0 ? ' rd' : '') + '">' + n + ' ' + unit + (n === 1 ? ' IS ' : ' ARE ') + (ready > 0 ? 'READY' : 'WAITING') + ' TO FIGHT</div>';
            }
        }
        let mejor = null;
        rv.forEach(r => {
            if (r.size !== size || r.cents === mio || r.ready <= 0) return;
            const d = Math.abs(r.cents - mio);
            if (!mejor || d < mejor.d || (d === mejor.d && r.cents > mejor.r.cents)) mejor = { d, r };
        });
        return mejor ? '<button class="sq-b sm gold sq-near" data-near="' + mejor.r.cents + '" data-size="' + size + '">' + usdLbl(mejor.r.cents / 100) + ' FIGHT · READY</button>' : '';
    }
    function searchingHtml() {
        const p = S.party, leader = imLeader();
        const secs = Math.max(0, Math.round((Date.now() - (p.queuedAt || Date.now())) / 1000));
        return '<div class="sq find"><div class="mid"><div class="sq-q">' + (p.custom ? 'ROOM OPEN · WAITING FOR A RIVAL' : 'SEARCHING FOR A RIVAL') + ' · ' + p.size + 'V' + p.size + ' · <span id="sqQs">' + secs + 's</span></div>' +
            '<div class="sq-side' + (p.size === 3 ? ' n3' : '') + '">' + groupHtml(false, p.size, true) + priceBox(p.fee, p.usd, p.size) + '</div></div>' +
            '<div class="sq-bot"><div class="sq-row"><button class="sq-b on" data-a="practice"' + (S.joining ? ' disabled' : '') + '>' + (S.joining ? 'JOINING...' : p.practice ? 'JOIN PRACTICE' : 'PLAY WHILE YOU WAIT') + '</button>' +
            (leader ? '<button class="sq-b" data-a="cancel">CANCEL</button>' : '') + '</div>' + errLine() + '</div></div>';
    }
    // Sala de espera: el lider ha elegido partida y precio; cada uno da (PAY &) READY cuando quiere. No caduca.
    function readyCheckHtml() {
        const p = S.party, rc = p.rc, leader = imLeader(), mine = rc.ready[S.me];
        const falta = Object.values(rc.ready).filter(v => !v).length;
        const paid = rc.fee > 0;
        const rok = mine ? '<button class="sq-b" disabled>READY ✓</button>'
            : '<button class="sq-b on" data-a="rok"' + (S.paying ? ' disabled' : '') + '>' + (S.paying ? 'SIGNING...' : paid ? 'PAY & READY' : 'READY') + '</button>';
        const all = leader && rc.size > 1 ? '<button class="sq-b" data-a="remind"' + (falta && !(falta === 1 && !mine) ? '' : ' disabled') + '>READY ALL</button>' : ghost('READY ALL');
        return '<div class="sq find"><div class="mid"><div class="sq-q">LOBBY · ' + (KIND_TXT[rc.kind] || 'MATCH') + ' · ' + rc.size + 'V' + rc.size + '</div>' +
            '<div class="sq-side' + (rc.size === 3 ? ' n3' : '') + '">' + groupHtml(false, p.size, true) + priceBox(rc.fee, rc.usd, rc.size) + '</div></div>' +
            '<div class="sq-bot"><div class="sq-row">' + rok + all +
            (leader ? '<button class="sq-b" data-a="cancel">CANCEL</button>' : '<button class="sq-b" data-a="leave">LEAVE</button>') +
            '</div>' + errLine() + '</div></div>';
    }
    // ----- MATCH CUSTOM: dos equipos con sus huecos, codigo para entrar, precio, cambiar de equipo y READY ALL para todos -----
    function customHtml() {
        const p = S.party, cm = p.cm, leader = imLeader(), n = cm.size;
        const team = t => p.members.filter(m => cm.team[m.id] === t);
        const myTeam = cm.team[S.me];
        const slot = (m, t) => {
            if (!m) return '<div class="sq-av empty"><span class="sq-pic">+</span>' + (myTeam !== t ? '<span class="k mv" data-cmt="' + t + '">MOVE HERE</span>' : '<div class="n" style="color:#4a5850">EMPTY</div>') + '</div>';
            return '<div class="sq-av' + (m.id === S.me ? ' me' : '') + '">' + pic(memberO(m)) + '<div class="n">' + esc(m.name) + '</div>' +
                (cm.ready[m.id] ? '<div class="l" style="color:#00ff66">READY</div>' : '<div class="l" style="color:#ffb347">WAITING…</div>') + '</div>';
        };
        const col = t => { const ms = team(t), out = []; for (let i = 0; i < n; i++) out.push(slot(ms[i], t)); return '<div class="tm ' + t.toLowerCase() + '"><div class="h">TEAM ' + t + '</div><div class="sq-grp small">' + out.join('') + '</div></div>'; };
        const usd = Math.round((cm.cents | 0) / 100);
        const sizes = leader ? SIZES.map(k => '<button class="sq-b sm' + (k === n ? ' on' : '') + '" data-cms="' + k + '">' + k + 'V' + k + '</button>').join('') : '<span class="sq-lab">' + n + 'V' + n + '</span>';
        const precio = leader
            ? '<button class="sq-b sm" data-cmp="-1"' + (usd > 0 ? '' : ' disabled') + '>-</button>' + priceLine(cm.fee, cm.usd, n) + '<button class="sq-b sm" data-cmp="1"' + (usd < 20 ? '' : ' disabled') + '>+</button>'
            : priceLine(cm.fee, cm.usd, n);
        const mine = cm.ready[S.me], falta = p.members.filter(m => !cm.ready[m.id] && m.id !== S.me).length;
        const rok = mine ? '<button class="sq-b" data-a="cmno">NOT READY</button>'
            : '<button class="sq-b on" data-a="cmok"' + (S.paying ? ' disabled' : '') + '>' + (S.paying ? 'SIGNING...' : cm.fee > 0 ? 'PAY & READY' : 'READY') + '</button>';
        const all = leader ? '<button class="sq-b" data-a="remind"' + (falta ? '' : ' disabled') + '>READY ALL</button>' : ghost('READY ALL');
        return '<div class="sq sq-fixed sq-cmw"><div class="sq-cmh"><span class="sq-lab">MATCH CUSTOM · CODE <b class="sq-code">' + esc(p.code) + '</b></span><span class="sz">' + sizes + '</span></div>' +
            '<div class="sq-row">' + precio + '</div>' +
            '<div class="sq-cm' + (n === 3 ? ' n3' : '') + '">' + col('A') + '<span class="vs">VS</span>' + col('B') + '</div>' +
            '<div class="sq-row">' + rok + all + '<button class="sq-b" data-a="cminv">INVITE</button>' + (leader ? '<button class="sq-b" data-a="cmclose">BACK</button>' : '<button class="sq-b red" data-a="leave">LEAVE</button>') + '</div>' + errLine() + '</div>';
    }
    // ----- panel ARENAS: modo (1V1/2V2/3V3) -> QUICK MATCH / FIND RIVALS / MATCH CUSTOM -----
    const arMode = () => 'arcade';   // arenas es un solo modo (con skills elegidas en THE PILL), se entre desde arcade o classic
    function modeTitle() { return 'ARENAS'; }
    const enHub = () => !!(S.box.rooms && S.box.rooms.closest && S.box.rooms.closest('#ahAr'));
    // App: titulo y BACK arriba (BACK grande junto a ARENAS; CLOSE siempre en la esquina derecha).
    function cabecera() {
        const ph = document.querySelector('#ahAr .ph'); if (!ph) return;
        let bk = ph.querySelector('.bk');
        if (!bk) {
            bk = document.createElement('button'); bk.className = 'px bk'; bk.textContent = 'BACK';
            ph.insertBefore(bk, ph.querySelector('.px:not(.bk)'));
            bk.onclick = () => { snd('simpleselect'); if (S.arStep && S.arStep.view) S.arStep.view = null; else S.arStep = null; S.err = ''; render(); };
        }
        const P = S.party, st = S.arStep, paso = !!(st && st.view !== 'rivals' && !(P && (P.rc || P.cm || P.state !== 'idle')));
        bk.style.display = paso ? '' : 'none';
        const w = ph.querySelector('.w'); if (w) w.textContent = modeTitle() + (paso ? ' · ' + st.size + 'V' + st.size + (st.view === 'price' ? ' · QUICK MATCH' : st.view === 'custom' ? ' · MATCH CUSTOM' : '') : '');
    }
    const usdLbl = usd => usd ? '$' + usd : 'FREE';
    function roomsHtml() {
        const p = S.party;
        if (p && p.state === 'match') return '<div class="sq find"><div class="mid"><div class="sq-q">MATCH IN PROGRESS</div>' + groupHtml(false, p.size, true) + '</div><div class="sq-bot"><div class="sq-row"><button class="sq-b on" data-a="rejoin">REJOIN</button><button class="sq-b red" data-a="leave">LEAVE</button></div>' + errLine() + '</div></div>';
        if (p && p.cm) return customHtml();
        if (p && (p.rc || p.state === 'queued') && S.arStep && S.arStep.view === 'rivals') {
            const n = S.arStep.size;
            return '<div class="sq sq-fixed"><div class="sq-row" style="justify-content:flex-start"><button class="sq-b sm" data-a="stepx">BACK</button><span class="sq-lab">' + n + 'V' + n + ' · FIND RIVALS</span></div><div class="sq-rl">' + rivalsHtml(n) + '</div>' + errLine() + '</div>';
        }
        if (p && p.rc) return readyCheckHtml();
        if (p && p.state === 'queued') return searchingHtml();
        const mine = groupSize(), step = S.arStep;
        if (!step) {
            const cards = SIZES.map(n => '<div class="sq-card" data-size="' + n + '"><canvas class="cvc" data-n="' + n + '"></canvas><div class="tag">' + ['DUEL', 'DUO', 'SQUAD'][n - 1] + '</div><div class="big">' + n + 'V' + n + '</div></div>').join('');
            const hint = mine > 1 ? 'YOUR GROUP · ' + mine + ' PLAYERS · ' + mine + 'V' + mine : 'PLAYING SOLO · FORM A GROUP IN FRIENDS FOR 2V2 / 3V3';
            return '<div class="sq"><div class="sq-row"><span class="sq-lab">' + hint + '</span></div><div class="sq-cards">' + cards + '</div>' + errLine() + '</div>';
        }
        const n = step.size, usd = S.usd | 0;
        const head = enHub() && step.view !== 'rivals' ? '' : '<div class="sq-row" style="justify-content:flex-start"><button class="sq-b sm" data-a="stepx">BACK</button><span class="sq-lab">' + n + 'V' + n + (step.view === 'price' ? ' · QUICK MATCH' : step.view === 'rivals' ? ' · FIND RIVALS' : step.view === 'custom' ? ' · MATCH CUSTOM' : '') + '</span></div>';
        if (step.view === 'rivals') return '<div class="sq sq-fixed">' + head + '<div class="sq-rl">' + rivalsHtml(n) + '</div>' + errLine() + '</div>';
        if (step.view === 'price') {
            const est = pillOf(usd);
            const chips = [0, 1, 2, 5, 10, 20].map(u => '<button class="sq-b sm' + (u === usd ? ' on' : '') + '" data-pu="' + u + '">' + usdLbl(u) + '</button>').join('');
            return '<div class="sq sq-fixed">' + head + '<div class="sq-menu">' +
                '<div class="sq-row">' + chips + '</div>' +
                '<div class="sq-price"><button class="sq-b" data-pr="-1"' + (usd > 0 ? '' : ' disabled') + '>-</button><div class="v"><b' + (usd ? '' : ' class="free"') + '>' + usdLbl(usd) + '</b><span>' + (usd ? (est ? '≈ ' + fmtPill(est) + ' PER PLAYER' : 'ENTRY PER PLAYER') : 'NO ENTRY · UP TO $20') + '</span></div><button class="sq-b" data-pr="1"' + (usd < 20 ? '' : ' disabled') + '>+</button></div>' +
                '<button class="sq-b on big" data-a="quick">PLAY · ' + usdLbl(usd) + '</button></div>' + errLine() + '</div>';
        }
        if (step.view === 'custom') {
            return '<div class="sq sq-fixed">' + head + '<div class="sq-menu">' +
                '<button class="sq-b on big" data-a="cmnew">CREATE ROOM · ' + n + 'V' + n + '</button>' +
                '<div class="sq-row" style="flex-wrap:nowrap;width:78%"><input class="sq-in" id="sqCode" maxlength="8" placeholder="ROOM CODE" autocomplete="off"><button class="sq-b on" data-a="cmjoin">JOIN ROOM</button></div>' +
                '<div class="sq-note">Create a room, share its code or invite friends, pick teams and price. It starts when both teams are full and everyone is READY.</div></div>' + errLine() + '</div>';
        }
        return '<div class="sq sq-fixed">' + head + '<div class="sq-menu">' +
            '<button class="sq-b on big" data-a="qpick">QUICK MATCH · ' + usdLbl(usd) + '</button>' +
            '<button class="sq-b big" data-a="rivals">FIND RIVALS</button>' +
            '<button class="sq-b big" data-a="custom">MATCH CUSTOM</button></div>' + errLine() + '</div>';
    }
    // Precio en dolares -> $PILLY aproximado (el real lo fija el servidor al entrar en el tramo).
    function pillOf(usd) {
        if (!usd) return 0;
        const q = (S.quote || []).find(x => x.usd === usd); if (q) return q.fee;
        const k = (S.quote || []).find(x => x.usd === 1); return k ? Math.round(k.fee * usd) : 0;
    }
    // FIND RIVALS: tramos de precio (FREE, UP TO $2, UP TO $5, UP TO $10, UP TO $20) con quien esta LISTO, mirando o jugando.
    const TRAMOS = [[0, 0], [1, 2], [3, 5], [6, 10], [11, 20]];
    function rivalsHtml(n) {
        const lst = (S.rivals || []).filter(r => r.size === n), P = S.party;
        // Donde estas tu: buscando (READY) o en la sala de espera (LOOKING) de ese precio.
        const yoReady = P && P.state === 'queued' && !P.custom && P.size === n ? P.cents | 0 : -1;
        const yoLook = P && P.rc && P.rc.kind === 'quick' && P.rc.size === n ? P.rc.cents | 0 : -1;
        return TRAMOS.map(([lo, hi]) => {
            const rows = lst.filter(r => r.cents >= lo * 100 && r.cents <= hi * 100);
            const fila = (cents, r) => {
                const usd = cents / 100, fee = r && r.fee ? r.fee : pillOf(usd), real = r && r.fee && S.pillUsd ? fmtUsd(r.fee * S.pillUsd) : null;
                const aqui = yoReady === cents || yoLook === cents;
                const otros = r ? r.ready + r.looking - (aqui ? groupSize() : 0) : 0;
                const st = r ? '<b>' + r.ready + ' READY' + (yoReady === cents ? ' (YOU)' : '') + '</b> · <i>' + r.looking + ' LOOKING' + (yoLook === cents ? ' (YOU)' : '') + '</i> · ' + r.playing + ' PLAYING' : 'NOBODY YET · BE THE FIRST';
                const bt = aqui ? '<button class="sq-b sm" disabled>YOU\'RE IN</button>'
                    : '<button class="sq-b sm ' + (otros > 0 ? 'gold' : 'on') + '" data-play="' + cents + '">FIGHT</button>';
                return '<div class="sq-rm' + (r ? '' : ' dim') + '"><span class="pr' + (cents ? '' : ' free') + '">' + (cents ? '$' + usd : 'FREE') + '</span><div class="w"><div class="n">' + (cents ? (real ? real + ' · ' : '') + fmtPill(fee) : 'NO ENTRY') + '</div><div class="s">' + st + '</div></div>' + bt + '</div>';
            };
            const body = rows.length ? rows.map(r => fila(r.cents, r)).join('') : fila(hi * 100, null);
            return '<div class="sq-rv-h' + (hi ? '' : ' free') + '">' + (hi ? 'UP TO $' + hi : 'FREE') + '</div>' + body;
        }).join('');
    }
    // Un amigo con el aviso activado (ALERT en FRIENDS) esta LISTO buscando partida: aviso ARENA con boton para ir a por el.
    function avisoListo(f) {
        if (S.party && (S.party.state !== 'idle' || S.party.rc || S.party.cm)) return;
        toast({ kind: 'arena', pic: f.p, text: esc(friendName(f)) + ' is READY for ' + f.q.size + 'V' + f.q.size + ' · ' + usdLbl(f.q.cents / 100), ms: 12000,
            actions: [['FIGHT', () => lanzar(f.q.size, f.q.cents / 100), 1], ['X', null]] });
    }
    // Un companero propone partida: al lider le sale el aviso y si acepta se lanza.
    function onPropose(m) {
        toast({ pic: m.pic, text: esc(m.from) + ' proposes ' + m.size + 'V' + m.size + ' · ' + usdLbl(m.cents / 100), warm: true, ms: 20000,
            actions: [['ACCEPT', () => lanzar(m.size, m.cents / 100), 1], ['NO', null]] });
    }
    // QUICK MATCH o FIGHT a un precio: comprueba el grupo (sin grupo, de otro tamano, o no eres el lider -> se propone).
    // ¿Tu grupo cuadra con esta partida? Si no, avisa (o en 1V1 con grupo, ofrece salir y luego sigue).
    function grupoOk(n, seguir) {
        const have = groupSize(), P = S.party;
        if (P && P.cm) { fail('You are in a custom room. Close it or leave it first.'); return false; }
        if (P && P.state === 'match') { fail('Your group is in a match right now.'); return false; }
        if (P && !imLeader()) { if (have !== n) { fail('Your group has ' + have + ' players: propose a ' + have + 'V' + have + '.'); return false; } return true; }
        if (P && (P.state === 'queued' || P.rc)) {
            const c = P.rc ? P.rc.cents : P.cents;
            rcPopup(have > 1 ? 'YOUR GROUP IS SEARCHING' : "YOU'RE SEARCHING", (have > 1 ? "Your group's " : 'Your ') + (c ? '$' + c / 100 : 'free') + ' match queue will be cancelled to continue.', 'CONTINUE', 'NO',
                () => { send({ a: 'cancel' }); P.rc = null; P.state = 'idle'; render(); seguir(); });
            return false;
        }
        if (n === 1 && have > 1) {
            rcPopup('THIS IS A 1V1', 'Leave your group to play it?', 'LEAVE GROUP', 'NO', () => { send({ a: 'leave' }); S.party = null; render(); seguir(); });
            return false;
        }
        if (have !== n) { fail(have < n ? 'To play ' + n + 'V' + n + ' you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: pick ' + have + 'V' + have + '.'); return false; }
        return true;
    }
    function lanzar(n, usd) {
        usd = Math.max(0, Math.min(20, Math.round(usd) || 0));
        if (!grupoOk(n, () => lanzar(n, usd))) return;
        if (S.party && !imLeader()) { send({ a: 'propose', price: usd, size: n }); S.note = 'Proposal sent to your leader'; render(); return; }
        S.usd = usd; try { localStorage.setItem('pw_arusd', String(usd)); } catch (e) {}
        if (S.arStep) S.arStep.view = null;   // se abre el grupo con su sala de espera
        start(() => send({ a: 'play', mode: arMode(), price: usd, ready: !usd }));   // gratis: pulsar es tu LISTO; de pago: PAY & READY
    }
    function quick() { lanzar(S.arStep ? S.arStep.size : groupSize(), S.usd | 0); }
    // PAY & READY: primero se confirma la entrada (precio exacto) y luego se firma.
    function confirmEntry(fee, cents, usd) {
        if (!(fee > 0)) { send({ a: 'ready', v: true }); return; }
        rcPopup('CONFIRM YOUR ENTRY', (usd != null ? fmtUsd(usd) + ' · ' : '') + fmtPill(fee) + ', paid from your game balance.', 'CONFIRM', 'CANCEL', () => readyPay(fee, cents));
    }

    // ----- panel AMIGOS: grupo, amigos y susurros -----
    function noAccount() {
        return '<div class="sq"><div class="sq-t">FRIENDS</div><div class="sq-p">' + (EN_APP
            ? 'Connect your wallet to get a friends list, invites and whispers. Your wallet is your account.'
            : 'Sign in with your wallet or your X account on the airdrop page to get a friends list, invites and whispers.') + '</div>' +
            '<div class="sq-row"><button class="sq-b on" data-a="login">' + (EN_APP ? 'CONNECT WALLET' : 'OPEN AIRDROP PAGE') + '</button><button class="sq-b" data-a="recheck">I DID IT</button></div></div>';
    }
    function friendsHtml() {
        if (S.x !== 'linked') return noAccount();
        const F = S.friends, p = S.party;
        const searching = !!(p && p.state === 'queued');
        const canInvite = !p || ((p.state === 'idle' || searching) && p.members.length < p.max && imLeader());
        if (S.chatWith) {
            const f = F.friends.find(x => x.id === S.chatWith) || { u: '?', p: '', st: 'off', id: S.chatWith };
            // Lo ultimo arriba, justo debajo de donde escribes: con el teclado del movil abierto se sigue viendo todo sin mover la ventana.
            const msgs = (S.chat[f.id] || []).slice().reverse().map(m => '<div class="' + (m.me ? 'me' : '') + '"><b>' + (m.me ? 'YOU' : esc(friendName(f))) + ':</b> ' + esc(m.text) + '</div>').join('') || '<div>Say hi to ' + esc(friendName(f)) + '.</div>';
            const emo = S.emo ? '<div class="sq-emo">' + EMOJIS.map(e => '<button data-emo="' + e + '">' + e + '</button>').join('') + '</div>' : '';
            return '<div class="sq"><div class="sq-row" style="justify-content:flex-start"><button class="sq-b sm" data-a="chatx">BACK</button>' + pic(f) + '<span style="font-size:.5em">' + esc(friendName(f)) + '</span></div>' +
                '<div class="sq-row" style="flex-wrap:nowrap"><input class="sq-in" id="sqMsg" maxlength="200" placeholder="Whisper…" autocomplete="off"><button class="sq-b sm' + (S.emo ? ' on' : '') + '" data-a="emo">😀</button><button class="sq-b sm on" data-a="wsend">SEND</button></div>' +
                emo + '<div class="sq-chat" id="sqChat">' + msgs + '</div>' + errLine() + '</div>';
        }
        // El grupo solo se enseña cuando de verdad hay alguien mas contigo.
        // Dos pantallas del mismo tamano: FRIENDS (lista) y GROUP (tu grupo). Asi el panel no crece al entrar alguien.
        const hayGrupo = !!(p && p.members.length >= 2);
        if (!hayGrupo) S.frTab = 'friends';
        const tabs = '<div class="sq-tabs"><button class="sq-tab' + (S.frTab !== 'group' ? ' on' : '') + '" data-tab="friends">FRIENDS</button>' +
            '<button class="sq-tab' + (S.frTab === 'group' ? ' on' : '') + '" data-tab="group"' + (hayGrupo ? '' : ' disabled') + '>GROUP' + (hayGrupo ? ' · ' + p.members.length + '/' + p.max : '') + '</button></div>';
        if (S.frTab === 'group' && hayGrupo) {
            return '<div class="sq sq-fixed">' + tabs + '<div class="sq-gw">' + groupHtml(true, p.members.length) + '</div>' +
                '<div class="sq-row"><button class="sq-b sm red" data-a="leave">LEAVE GROUP</button></div></div>';
        }
        const grp = '';
        const aviso = searching ? '<div class="sq-note" style="color:#ffb347">You are searching for a match. If a friend accepts your invite, the search is cancelled.</div>' : '';
        const invs = liveInvites();
        const invHtml = invs.length ? '<div class="sq-h">GROUP INVITES</div><div class="sq-list">' + invs.map(i => '<div class="sq-it">' + pic(i.from) + '<div class="w"><div class="n">' + esc(nameOf(i.from)) + '</div><div class="s">invites you to a group</div></div><div class="a"><button class="sq-b sm on" data-ij="' + esc(i.from.id) + '">JOIN</button><button class="sq-b sm" data-ix="' + esc(i.from.id) + '">NO</button></div></div>').join('') + '</div>' : '';
        const reqs = F.inReq.length ? '<div class="sq-h">REQUESTS</div><div class="sq-list">' + F.inReq.map(r => '<div class="sq-it">' + pic(r) + '<div class="w"><div class="n">' + esc(nameOf(r)) + '</div></div><div class="a"><button class="sq-b sm on" data-ac="' + r.id + '">ACCEPT</button><button class="sq-b sm" data-dc="' + r.id + '">NO</button></div></div>').join('') + '</div>' : '';
        const order = { on: 0, party: 1, wait: 1, game: 1, off: 2 };
        const list = F.friends.slice().sort((a, b) => order[a.st] - order[b.st] || nameOf(a).localeCompare(nameOf(b))).map(f =>
            '<div class="sq-it">' + pic(f) + '<div class="w">' + (S.nickEdit === f.id
                ? '<input class="sq-in" id="sqNick" maxlength="16" placeholder="NICKNAME (ONLY YOU SEE IT)" value="' + esc(nicks[f.id] || '') + '" autocomplete="off">'
                : '<div class="n">' + esc(friendName(f)) + (S.unread[f.id] ? '<span class="sq-bd">' + S.unread[f.id] + '</span>' : '') + '</div>') +
            '<div class="s ' + f.st + '"><i></i>' + (f.q ? 'READY ' + f.q.size + 'V' + f.q.size + ' · ' + usdLbl(f.q.cents / 100) : ST[f.st]) + (nicks[f.id] ? ' · ' + esc(nameOf(f)) : '') + '</div></div>' +
            (S.nickEdit === f.id ? '<div class="a"><button class="sq-b sm on" data-nks="' + f.id + '">SAVE</button><button class="sq-b sm" data-nkc="1">X</button></div>' :
            '<div class="a">' + (f.q ? '<button class="sq-b sm gold" data-fight="' + f.id + '">FIGHT</button>' : '') + (canInvite && f.st !== 'off' && !(p && p.members.some(x => x.uid === f.id)) ? '<button class="sq-b sm on" data-inv="' + f.id + '"' + (searching ? ' data-warn="1"' : '') + '>INVITE</button>' : '') + '<button class="sq-b sm' + (S.unread[f.id] ? ' blink' : '') + '" data-w="' + f.id + '"' + (f.st === 'off' ? ' disabled' : '') + '>WHISPER</button><button class="sq-b sm" data-nk="' + f.id + '">NICK</button><button class="sq-b sm' + (S.watch[f.id] ? ' on' : '') + '" data-wt="' + f.id + '">' + (S.watch[f.id] ? 'ALERT ON' : 'ALERT') + '</button><button class="sq-b sm' + (S.mute.ids[f.id] ? ' on' : '') + '" data-mu="' + f.id + '">' + (S.mute.ids[f.id] ? 'UNMUTE' : 'MUTE') + '</button><button class="sq-b sm red" data-rm="' + f.id + '">X</button></div>') + '</div>').join('');
        return '<div class="sq sq-fixed">' + tabs + grp + aviso +
            '<div class="sq-row" style="flex-wrap:nowrap"><input class="sq-in" id="sqAdd" maxlength="48" placeholder="ADD: @X NAME, WALLET OR CODE" autocomplete="off"><button class="sq-b sm on" data-a="fadd">ADD</button><button class="sq-b sm' + (S.mute.all ? ' red' : '') + '" data-a="muteall">' + (S.mute.all ? 'POPUPS OFF' : 'POPUPS ON') + '</button></div>' +
            invHtml + reqs + '<div class="sq-h">FRIENDS · ' + F.friends.filter(f => f.st !== 'off').length + ' ONLINE</div>' +
            '<div class="sq-list">' + (list || '<div class="sq-note" style="padding:.8em">No friends yet. Add someone by their @X name, wallet address or friend code (it is in your profile). They need to have opened Arenas or Friends once.</div>') + '</div>' +
            (F.outReq.length ? '<div class="sq-note">Pending: ' + F.outReq.map(r => esc(nameOf(r))).join(', ') + '</div>' : '') + errLine() + '</div>';
    }

    function paint(kind, html) {
        const box = S.box[kind]; if (!box) return;
        const add = box.querySelector('#sqAdd'), msg = box.querySelector('#sqMsg');
        const keep = add ? add.value : null, keepMsg = msg ? msg.value : null, focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
        const rl = box.querySelector('.sq-rl, .sq-list'), scr = rl ? rl.scrollTop : 0;
        box.innerHTML = html;
        const rl2 = box.querySelector('.sq-rl, .sq-list'); if (rl2 && scr) rl2.scrollTop = scr;
        if (keep != null && box.querySelector('#sqAdd')) box.querySelector('#sqAdd').value = keep;
        if (keepMsg != null && box.querySelector('#sqMsg')) box.querySelector('#sqMsg').value = keepMsg;
        if (focus && box.querySelector('#' + focus)) box.querySelector('#' + focus).focus();
        const c = box.querySelector('#sqChat'); if (c) c.scrollTop = 0;   // lo ultimo esta arriba
        hydrate(box);
        wire(box);
    }
    function render() {
        if (S.note) { const t = S.note; S.note = ''; toast({ text: esc(t), warm: true, ms: 2500, center: true }); }
        if (S.err) { const t = S.err; S.err = ''; toast({ text: esc(t), warm: true, ms: 4000, center: true }); }   // los avisos de error tambien como popup: nada pegado debajo de las listas   // los avisos cortos van como popup, no dentro del menu
        if (S.box.rooms) { paint('rooms', roomsHtml()); drawCards(S.box.rooms); cabecera(); }
        pedirRivales(false);
        if (S.box.friends) paint('friends', friendsHtml());
        try { if (window.PWSquadHooks) { if (PWSquadHooks.afterRender) PWSquadHooks.afterRender(); if (PWSquadHooks.badge) PWSquadHooks.badge(badgeCount()); } } catch (e) {}
    }
    // En el lobby o buscando, el boton de la sala cercana necesita FIND RIVALS al dia (como mucho cada 3 s al repintar).
    function pedirRivales(fuerza) {
        const P = S.party;
        if (!P || P.custom || !(P.rc || P.state === 'queued') || !isOpen('rooms') || (S.arStep && S.arStep.view === 'rivals')) return;
        if (!fuerza && Date.now() - (S.rvAt || 0) < 3000) return;
        S.rvAt = Date.now(); send({ a: 'rivals', size: P.size });
    }
    function fail(msg) { S.err = msg; S.note = ''; render(); }
    function start(then) { connect(() => { if (!S.party) send({ a: 'create', name: myName() }); then(); }); }

    function wire(b) {
        b.querySelectorAll('[data-new]').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.new, have = groupSize();
            if (!imLeader()) return fail('Only your group leader can create rooms.');
            if (have !== n) return fail(have === 1 ? 'To play ' + n + 'V' + n + ' you need a group of ' + n + '. Invite friends in FRIENDS.' : 'Your group has ' + have + ' players: pick a ' + have + 'V' + have + ' room.');
            start(() => send({ a: 'play', custom: true, size: n, mode: arMode() }));
        });
        b.querySelectorAll('.sq-card').forEach(x => x.onclick = () => {
            snd('simpleselect');
            const n = +x.dataset.size;
            S.err = ''; S.arStep = { size: n, view: null }; render();
            connect(() => send({ a: 'rivals', size: S.arStep ? S.arStep.size : 1 }));   // cotizacion del $PILLY para el precio
        });
        b.querySelectorAll('[data-k]').forEach(x => x.onclick = () => send({ a: 'kick', id: x.dataset.k }));
        b.querySelectorAll('[data-pr]').forEach(x => x.onclick = () => {
            snd('simpleselect');
            S.usd = Math.max(0, Math.min(20, (S.usd | 0) + (+x.dataset.pr)));
            try { localStorage.setItem('pw_arusd', String(S.usd)); } catch (e) {}
            render();
            // Los del mismo tramo ven que estas mirando (FIND RIVALS: LOOKING) y les llega el aviso.
            clearTimeout(S.wantT); S.wantT = setTimeout(() => { if (S.party && S.party.state === 'idle') send({ a: 'want', cents: (S.usd | 0) * 100 }); }, 700);
        });
        b.querySelectorAll('[data-near]').forEach(x => x.onclick = () => { snd('simpleselect'); lanzar(+x.dataset.size, (+x.dataset.near) / 100); });
        b.querySelectorAll('[data-play]').forEach(x => x.onclick = () => { snd('simpleselect'); lanzar(S.arStep.size, (+x.dataset.play) / 100); });
        b.querySelectorAll('[data-pu]').forEach(x => x.onclick = () => {
            snd('simpleselect'); S.usd = +x.dataset.pu;
            try { localStorage.setItem('pw_arusd', String(S.usd)); } catch (e) {}
            render();
        });
        b.querySelectorAll('[data-cms]').forEach(x => x.onclick = () => { snd('simpleselect'); send({ a: 'cmset', size: +x.dataset.cms }); });
        b.querySelectorAll('[data-cmp]').forEach(x => x.onclick = () => { snd('simpleselect'); const cm = S.party && S.party.cm; if (cm) send({ a: 'cmset', price: Math.max(0, Math.min(20, Math.round(cm.cents / 100) + (+x.dataset.cmp))) }); });
        b.querySelectorAll('[data-cmt]').forEach(x => x.onclick = () => { snd('simpleselect'); send({ a: 'cmteam', team: x.dataset.cmt }); });
        const codeIn = b.querySelector('#sqCode');
        if (codeIn) codeIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="cmjoin"]').click(); };
        const guardaMute = () => { try { localStorage.setItem('pw_wmute', JSON.stringify(S.mute)); } catch (e) {} };
        b.querySelectorAll('[data-wt]').forEach(x => x.onclick = () => { snd('simpleselect'); const id = x.dataset.wt; if (S.watch[id]) delete S.watch[id]; else S.watch[id] = 1; try { localStorage.setItem('pw_fwatch', JSON.stringify(S.watch)); } catch (e) {} render(); });
        b.querySelectorAll('[data-fight]').forEach(x => x.onclick = () => { const f = S.friends.friends.find(y => y.id === x.dataset.fight); if (f && f.q) { snd('simpleselect'); lanzar(f.q.size, f.q.cents / 100); } });
        b.querySelectorAll('[data-mu]').forEach(x => x.onclick = () => { snd('simpleselect'); const id = x.dataset.mu; if (S.mute.ids[id]) delete S.mute.ids[id]; else S.mute.ids[id] = 1; guardaMute(); render(); });
        b.querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { if (x.disabled) return; snd('simpleselect'); S.frTab = x.dataset.tab; render(); });
        b.querySelectorAll('[data-nk]').forEach(x => x.onclick = () => { S.nickEdit = x.dataset.nk; render(); const i = b.querySelector('#sqNick'); if (i) i.focus(); });
        b.querySelectorAll('[data-nks]').forEach(x => x.onclick = () => { const i = b.querySelector('#sqNick'); setNick(x.dataset.nks, i ? i.value : ''); S.nickEdit = null; render(); });
        b.querySelectorAll('[data-nkc]').forEach(x => x.onclick = () => { S.nickEdit = null; render(); });
        const nkIn = b.querySelector('#sqNick');
        if (nkIn) nkIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-nks]').click(); };
        b.querySelectorAll('[data-ij]').forEach(x => x.onclick = () => { const inv = S.invites.find(i => i.from.id === x.dataset.ij); if (!inv) return; snd('simpleselect'); S.invites = S.invites.filter(i => i !== inv); joinInvite(inv); });
        b.querySelectorAll('[data-ix]').forEach(x => x.onclick = () => { snd('simpleselect'); dropInvite(x.dataset.ix); });
        b.querySelectorAll('[data-ac]').forEach(x => x.onclick = () => send({ a: 'faccept', id: x.dataset.ac }));
        b.querySelectorAll('[data-dc]').forEach(x => x.onclick = () => send({ a: 'fdecline', id: x.dataset.dc }));
        b.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { if (x.dataset.sure === '1') send({ a: 'fremove', id: x.dataset.rm }); else { x.dataset.sure = '1'; x.textContent = 'SURE?'; setTimeout(() => { if (x.isConnected) { x.dataset.sure = ''; x.textContent = 'X'; } }, 2500); } });
        // Invitar sin grupo crea el grupo (el servidor atiende en orden: create y luego la invitacion).
        b.querySelectorAll('[data-inv]').forEach(x => x.onclick = () => {
            snd('simpleselect'); const id = x.dataset.inv;
            // Buscando partida: primero se avisa de que si aceptan se sale de la cola.
            if (x.dataset.warn === '1' && x.dataset.sure !== '1') { x.dataset.sure = '1'; x.textContent = 'LEAVE QUEUE?'; setTimeout(() => { if (x.isConnected) { x.dataset.sure = ''; x.textContent = 'INVITE'; } }, 3500); return; }
            start(() => send({ a: 'pinvite', id }));
        });
        b.querySelectorAll('[data-w]').forEach(x => x.onclick = () => { S.chatWith = x.dataset.w; S.unread[x.dataset.w] = 0; render(); const i = b.querySelector('#sqMsg'); if (i) i.focus(); });
        const addIn = b.querySelector('#sqAdd');
        if (addIn) addIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="fadd"]').click(); };
        b.querySelectorAll('[data-emo]').forEach(x => x.onclick = () => {
            const i = b.querySelector('#sqMsg'); if (!i) return;
            const a = i.selectionStart == null ? i.value.length : i.selectionStart, z = i.selectionEnd == null ? a : i.selectionEnd;
            i.value = (i.value.slice(0, a) + x.dataset.emo + i.value.slice(z)).slice(0, 200);
            i.focus(); const pos = Math.min(i.value.length, a + x.dataset.emo.length); try { i.setSelectionRange(pos, pos); } catch (e) {}
        });
        const msgIn = b.querySelector('#sqMsg');
        if (msgIn) msgIn.onkeydown = e => { if (e.key === 'Enter') b.querySelector('[data-a="wsend"]').click(); };
        b.querySelectorAll('[data-a]').forEach(x => x.onclick = () => {
            const a = x.dataset.a; snd('simpleselect');
            if (a === 'quick') quick();
            else if (a === 'seerivals') { const P = S.party; S.arStep = { size: P.rc ? P.rc.size : P.size, view: 'rivals' }; render(); send({ a: 'rivals', size: S.arStep.size }); }
            else if (a === 'qpick') { const ver = () => { if (S.arStep) { S.arStep.view = 'price'; render(); } }; if (grupoOk(S.arStep.size, ver)) ver(); }
            else if (a === 'custom') { S.arStep.view = 'custom'; render(); }
            else if (a === 'cmnew') { const n = S.arStep.size; if (S.party && !imLeader()) return fail('Only your group leader can create rooms.'); if (groupSize() > n * 2) return fail('Your group does not fit in a ' + n + 'V' + n + ' room.'); start(() => send({ a: 'cmopen', size: n, price: S.usd | 0 })); }
            else if (a === 'cmjoin') { const v = ((b.querySelector('#sqCode') || {}).value || '').trim().toUpperCase(); if (!v) return fail('Type the room code.'); connect(() => { if (S.party) { send({ a: 'leave' }); S.party = null; } send({ a: 'join', code: v, name: myName() }); }); }
            else if (a === 'cmok') { const cm = S.party && S.party.cm; if (cm) confirmEntry(cm.fee, cm.cents, cm.usd); }
            else if (a === 'cmno') send({ a: 'ready', v: false });
            else if (a === 'cminv') openFriends();
            else if (a === 'cmclose') send({ a: 'cmclose' });
            else if (a === 'rivals') { S.arStep.view = 'rivals'; render(); connect(() => send({ a: 'rivals', size: S.arStep ? S.arStep.size : 1 })); }
            else if (a === 'stepx') { if (S.arStep && S.arStep.view) S.arStep.view = null; else S.arStep = null; S.err = ''; render(); }
            else if (a === 'rejoin') { send({ a: 'rejoin' }); }
            else if (a === 'practice') { if (S.joining) return; S.joining = true; render(); clearTimeout(S.joinT); S.joinT = setTimeout(() => { S.joining = false; render(); }, 20000); send({ a: 'practice' }); }   // el boton pasa a JOINING... hasta que la partida arranca
            else if (a === 'remind') { send({ a: 'remind' }); S.note = 'Ready check sent to everyone'; render(); setTimeout(() => { S.note = ''; render(); }, 1500); }
            else if (a === 'rok') { const rc = S.party && S.party.rc; if (rc) confirmEntry(rc.fee, rc.cents, rc.usd); }
            else if (a === 'rno') { send({ a: 'ready', v: false }); hideRc(); }
            else if (a === 'cancel') send({ a: 'cancel' });
            else if (a === 'leave') { send({ a: 'leave' }); S.party = null; S.err = ''; render(); }
            else if (a === 'fadd') { const v = (b.querySelector('#sqAdd').value || '').trim(); if (v) { send({ a: 'fadd', u: v }); b.querySelector('#sqAdd').value = ''; S.note = 'Request sent!'; S.err = ''; } }
            else if (a === 'chatx') { S.chatWith = null; S.emo = false; render(); }
            else if (a === 'emo') { S.emo = !S.emo; render(); const i = b.querySelector('#sqMsg'); if (i) i.focus(); }
            else if (a === 'muteall') { S.mute.all = !S.mute.all; try { localStorage.setItem('pw_wmute', JSON.stringify(S.mute)); } catch (e) {} render(); }
            else if (a === 'wsend') { const i = b.querySelector('#sqMsg'), v = (i.value || '').trim(); if (v) { send({ a: 'whisper', id: S.chatWith, text: v }); i.value = ''; } }
            else if (a === 'login') login();
            else if (a === 'recheck') loadIdentity(true).then(() => { if (S.x === 'linked') { if (S.ws) { S.ws.close(); } connect(() => send({ a: 'friends' })); } else S.err = 'Not signed in yet.'; render(); });
        });
    }
    function login() {
        // App: el perfil del hub conecta la wallet. PC: la pagina del airdrop.
        if (EN_APP && typeof window._hubConnectX === 'function') { closeAll(); window._hubConnectX(); return; }
        window.open('/airdrop', '_blank');
    }
    // El contador de la busqueda se actualiza sin repintar todo.
    setInterval(() => {
        const q = document.getElementById('sqQs');
        if (q && S.party && S.party.queuedAt) q.textContent = Math.max(0, Math.round((Date.now() - S.party.queuedAt) / 1000)) + 's';
    }, 1000);

    // ---------------- montaje ----------------
    function pcPanel(kind) {
        if (S.pc[kind]) return S.pc[kind];
        const r = document.createElement('div'); r.className = 'sq-pcp'; r.id = 'sqPc' + (kind === 'friends' ? 'Fr' : '');
        r.innerHTML = '<div class="sq-box"><button class="sq-x">CLOSE</button><div class="sq-body"></div></div>';
        r.querySelector('.sq-x').onclick = () => r.classList.remove('open');
        r.addEventListener('click', e => { if (e.target === r) r.classList.remove('open'); });
        document.body.appendChild(r);
        S.pc[kind] = r; return r;
    }
    function isOpen(kind) {
        const hub = document.getElementById(kind === 'friends' ? 'ahFr' : 'ahAr');
        return !!((hub && hub.classList.contains('open')) || (S.pc[kind] && S.pc[kind].classList.contains('open')));
    }
    function closeAll() {
        S.joining = false; clearTimeout(S.joinT);
        for (const id of ['ahAr', 'ahFr']) { const e = document.getElementById(id); if (e) e.classList.remove('open'); }
        for (const k of Object.keys(S.pc)) S.pc[k].classList.remove('open');
        clearInterval(S.roomsTimer); S.roomsTimer = null;
    }
    function watchRooms() {
        clearInterval(S.roomsTimer);
        S.roomsTimer = setInterval(() => { if (isOpen('rooms') && S.arStep && S.arStep.view === 'rivals') send({ a: 'rivals', size: S.arStep.size }); else pedirRivales(true); }, 4000);   // FIND RIVALS al dia
    }
    // La app monta cada panel dentro del suyo (el hub llama con su contenedor).
    function mountIn(kind, box) {
        S.box[kind] = box; S.err = ''; S.note = ''; if (kind === 'rooms') S.arStep = null;
        if (kind === 'friends') loadIdentity(true).then(() => { connect(() => send({ a: 'friends' })); render(); });
        else connect(watchRooms);
        render();
    }
    function openPc(kind) {
        closePcBackdrops();
        const r = pcPanel(kind); r.classList.add('open');
        S.box[kind] = r.querySelector('.sq-body'); S.err = ''; S.note = ''; if (kind === 'rooms') S.arStep = null;
        try { closePlayChoice(); } catch (e) {}
        if (kind === 'friends') loadIdentity(true).then(() => { connect(() => send({ a: 'friends' })); render(); });
        else connect(watchRooms);
        render();
    }
    function closePcBackdrops() { for (const k of Object.keys(S.pc)) S.pc[k].classList.remove('open'); }
    function open() { if (EN_APP && document.getElementById('ahAr')) return; openPc('rooms'); }
    function openFriends() {
        if (EN_APP && document.getElementById('ahFr')) { const b = document.querySelector('#appHub [data-a="friends"]'); if (b) b.click(); } else openPc('friends');
    }
    // Conexion en segundo plano: con cuenta se reciben invitaciones y susurros aunque el panel este cerrado.
    async function boot() {
        await loadIdentity(true);
        if (S.x === 'linked' && !(S.ws && S.ws.readyState === 1)) connect();
    }
    function joinFromLink() {
        const c = new URLSearchParams(location.search).get('party');
        if (!c || !/^[A-Za-z0-9]{5}$/.test(c)) { setTimeout(boot, 2500); return; }
        setTimeout(() => joinCode(c.toUpperCase()), 1200);
    }
    // PLAY normal con el grupo buscando (o en LISTO): avisa de que se sale de la cola y del grupo, y solo entonces sigue.
    function guardPlay(proceed) {
        const p = S.party;
        if (!p || !(p.state === 'queued' || p.rc)) return proceed();
        let el = document.getElementById('sqGuard');
        if (!el) {
            el = document.createElement('div'); el.id = 'sqGuard';
            el.innerHTML = '<div class="bx"><div>YOU ARE IN THE ARENA QUEUE.<br>PLAYING A NORMAL ROOM LEAVES THE QUEUE AND YOUR GROUP.</div><div class="r"><button class="sq-b" data-g="no">STAY</button><button class="sq-b on" data-g="go">LEAVE & PLAY</button></div></div>';
            frame().appendChild(el);
        }
        el.classList.add('show');
        el.onclick = e => {
            const g = e.target.dataset && e.target.dataset.g; if (!g) return;
            el.classList.remove('show');
            if (g === 'go') { send({ a: 'leave' }); S.party = null; S.err = ''; rivalsBanner(); render(); proceed(); }
        };
    }
    // Las barras y las marcas de companeros solo existen dentro de la partida de arenas.
    setInterval(() => {
        const h = document.getElementById('sqHud');
        if ((h && h.classList.contains('show') || S.rel) && !(typeof gameRunning !== 'undefined' && gameRunning)) { if (h) h.classList.remove('show'); S.rel = null; S.allies = null; rivalsBanner(); }
    }, 700);
    window.pwSquadGuard = guardPlay;
    window.pwSquadIntro = intro;
    window.pwSquadLineup = () => { if (!S.lineup) return null; const d = document.createElement('div'); d.innerHTML = S.lineup; hydrate(d); return d.firstChild; };
    window.pwSquadFrame = frame;
    window.pwSquadCloseAll = closeAll;
    window.pwToast = toast;
    function leaveGame() { const h = document.getElementById('sqHud'); if (h) { h.classList.remove('show'); h.innerHTML = ''; } S.rel = null; S.allies = null; rivalsBanner(); }
    window.PWSquad = { open, openFriends, mountIn, onRoster, onEnd, onAllies, onPrize, prizes, claimAll, leaveGame, boot, refreshAv, practiceAgain, dispatch: onMsg, state: S };
    // Para el render: 'ally' (companero, aro azul), 'foe' (rival real, aro rojo) o null.
    window.pwSquadRel = id => (S.rel ? S.rel.get(id) || null : null);
    window.pwSquadTarget = () => (S.allies && Date.now() - S.allies.t < 2500 ? S.allies.tg : null);
    // Flecha azul: cada uno senala a UN companero, siempre el mismo (en corro por orden de id); si muere uno, los dos que quedan se senalan.
    window.pwSquadAllies = () => {
        if (!(S.allies && Date.now() - S.allies.t < 2500)) return null;
        const a = S.allies.a, me = S.roster && S.roster.myId;
        if (!me || a.length < 2) return a;
        const ids = [me].concat(a.map(x => x.id)).sort(), sig = ids[(ids.indexOf(me) + 1) % ids.length];
        return a.filter(x => x.id === sig);
    };
    if (document.readyState === 'complete') joinFromLink(); else addEventListener('load', joinFromLink);
})();
