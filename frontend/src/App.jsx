import { useEffect } from "react";
import "./legacy/app.css";

function App() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    if (!window.__API_BASE_URL__) {
      const tailscaleApi = "http://100.117.52.45:3000/api";
      const defaultApi = `${window.location.origin}/api`;
      const hostname = window.location.hostname;
      const port = window.location.port || "";
      const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
      const isLiveServer = port === "5500";
      window.__API_BASE_URL__ = isLocalhost && isLiveServer ? tailscaleApi : defaultApi;
    }

    let cancelled = false;
    const loadLegacyApp = async () => {
      if (window.__LUGGO_LEGACY_INITIALIZED__) return;
      try {
        await import("./legacy/app.js");
        if (!cancelled) {
          window.__LUGGO_LEGACY_INITIALIZED__ = true;
        }
      } catch (error) {
        console.error("No se pudo iniciar la aplicación legacy:", error);
      }
    };

    loadLegacyApp();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div id="loginOverlay" className="login-overlay">
        <div className="login-card">
          <h1>LUGGO</h1>
          <p className="login-note">Inicia sesión para continuar.</p>
          <button id="loginGoogle" className="btn primary" type="button">
            Continuar con Google
          </button>
          <div className="sp-1"></div>
          <form id="loginForm" className="login-form">
            <div>
              <label htmlFor="loginEmail">Correo electrónico</label>
              <input
                id="loginEmail"
                name="email"
                type="email"
                placeholder="tu@ejemplo.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label htmlFor="loginPassword">Contraseña</label>
              <input
                id="loginPassword"
                name="password"
                type="password"
                placeholder="Contraseña"
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn ghost">
              Ingresar con correo
            </button>
          </form>
          <div id="loginStatus" className="login-status" role="alert"></div>
          <p className="login-note">
            Si no tienes cuenta la crearemos al iniciar sesión.
          </p>
        </div>
      </div>

      <div className="app">
        <header>
          <div className="topbar">
            <div className="logo">
              <div className="logo-badge">
                <span>LG</span>
              </div>
              <div>LUGGO</div>
            </div>
            <div className="search">
              <input id="searchInput" placeholder="Buscar lugares o etiquetas" />
            </div>
          </div>
        </header>

        <main>
          <section className="screen active" data-screen="feed">
            <div id="feedList"></div>
          </section>

          <section className="screen" data-screen="map">
            <div className="map-tools">
              <form id="mapSearchForm" className="map-search">
                <input
                  id="mapSearchInput"
                  type="search"
                  placeholder="Buscar lugar en el mapa"
                  autoComplete="off"
                />
                <button type="submit" className="btn">
                  Buscar
                </button>
              </form>
              <div id="mapSearchSuggestions" className="map-suggestions" aria-live="polite"></div>
              <div id="mapSearchStatus" className="map-status" aria-live="polite"></div>
            </div>
            <div id="map" className="map-box"></div>
            <div className="sp-2"></div>
            <div className="muted">
              Busca un lugar, arrastra el mapa y toca un marcador para ver detalles.
            </div>
          </section>

          <section className="screen" data-screen="add">
            <div className="card" style={{ padding: "1rem" }}>
              <div className="title">Crear reseña</div>
              <div className="sp-2"></div>
              <button className="btn primary" onClick={() => window.openCreateModal?.()}>
                Nueva reseña
              </button>
              <div className="sp-2"></div>
              <div className="muted">Selecciona un punto en el mapa para registrar el lugar.</div>
            </div>
          </section>

          <section className="screen" data-screen="profile">
            <div className="card" style={{ padding: "1rem" }}>
              <div className="row">
                <div className="row" style={{ gap: ".6rem" }}>
                  <div className="avatar">U</div>
                  <div>
                    <div className="title" id="profileName">
                      Usuario Demo
                    </div>
                    <div className="muted">
                      <span id="profileHandle">@demo</span> - <span id="profileStats"></span>
                    </div>
                  </div>
                </div>
                <button className="btn ghost" onClick={() => window.logout?.()}>
                  Cerrar sesión
                </button>
              </div>
            </div>
            <div className="sp-2"></div>
            <div id="profileList"></div>
          </section>
        </main>

        <div className="fab">
          <button onClick={() => window.openCreateModal?.()}>Añadir</button>
        </div>

        <nav className="tabbar">
          <div className="tabs">
            <button className="active" data-tab="feed">
              Inicio
            </button>
            <button data-tab="map">Mapa</button>
            <button data-tab="add">Agregar</button>
            <button data-tab="profile">Perfil</button>
          </div>
        </nav>
      </div>

      <div id="modal" className="modal-backdrop">
        <div className="modal">
          <h3>Registrar reseña</h3>
          <div className="grid" style={{ marginBottom: "0.8rem" }}>
            <div style={{ gridColumn: "1/-1" }}>
              <form id="addPlaceSearchForm" className="map-search">
                <input
                  id="addPlaceSearchInput"
                  type="search"
                  placeholder="Buscar lugar para reseñar"
                  autoComplete="off"
                />
                <button type="submit" className="btn">
                  Buscar
                </button>
              </form>
              <div
                id="addPlaceSuggestions"
                className="map-suggestions"
                aria-live="polite"
              ></div>
              <div id="addPlaceStatus" className="map-status" aria-live="polite"></div>
            </div>
            <div className="modal-map" style={{ gridColumn: "1/-1" }}>
              <div id="addPlaceMap" className="map-box"></div>
              <div className="map-hint">
                Haz clic en el mapa o en un resultado para seleccionar el lugar.
              </div>
            </div>
            <div>
              <label>Nombre del lugar</label>
              <input id="f_placeName" readOnly placeholder="Ej. Parque Central" />
            </div>
            <div>
              <label>Dirección / Ciudad</label>
              <input id="f_placeAddress" readOnly placeholder="Ciudad o dirección" />
            </div>
            <div>
              <label>Calificación</label>
              <select id="f_rating">
                <option value="5">5 estrellas</option>
                <option value="4">4 estrellas</option>
                <option value="3">3 estrellas</option>
                <option value="2">2 estrellas</option>
                <option value="1">1 estrella</option>
              </select>
            </div>
            <div>
              <label>Foto (URL opcional)</label>
              <input id="f_photo" placeholder="https://" />
            </div>
            <div>
              <label>Subir imagen (archivo local)</label>
              <input id="f_photo_file" type="file" accept="image/*" />
            </div>
            <div className="photo-preview" id="photoPreview" style={{ gridColumn: "1/-1" }}></div>
            <div style={{ gridColumn: "1/-1" }}>
              <label>Tu reseña</label>
              <textarea id="f_note" placeholder="¿Qué te gustó? ¿Consejos para otros?"></textarea>
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <label>Etiquetas (coma separadas)</label>
              <input id="f_tags" placeholder="café, brunch, wifi" />
            </div>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => window.closeCreateModal?.()}>
              Cancelar
            </button>
            <button className="btn primary" onClick={() => window.saveReview?.()}>
              Guardar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
