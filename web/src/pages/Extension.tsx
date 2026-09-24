import { useState } from "react";
import { Page } from "../App";
import { mutate, toast } from "../lib";
import { Icon } from "../ui/icons";

export function ExtensionPage() {
  const [token, setToken] = useState<string | null>(null);
  const create = async () => {
    const r = await mutate<{ token: string }>("/tokens", "POST", { label: "Chrome-расширение" });
    setToken(r.token);
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Скопировано"));

  return (
    <Page title="Расширение" sub="Не пускает на YouTube и TikTok, пока не сделано главное">
      <div className="bento">
        <section className="card span-7">
          <div className="eyebrow">Как это работает</div>
          <h2 className="serif" style={{ fontSize: 30, margin: "10px 0 16px", lineHeight: 1.2 }}>
            Сначала математика.
            <br />
            Потом — всё остальное.
          </h2>
          <ol className="steps">
            <li>
              Открываешь <b>YouTube / TikTok / Instagram</b>, а привычка с флажком «блокировать» ещё не сделана — экран закрывается.
            </li>
            <li>
              Жмёшь <b>«Начать»</b> — расширение ведёт на сайт для занятий (например, Khan Academy) и запускает фокус-сессию.
            </li>
            <li>
              Считается только <b>активное</b> время на нужных сайтах: вкладка открыта, окно в фокусе, ты двигаешь мышью, печатаешь, листаешь или идёт видео. Клики и нажатия тоже пишутся.
            </li>
            <li>
              Набрал норму (например, 60 минут) — привычка отмечается сама, блокировка снимается, прилетает уведомление.
            </li>
            <li>
              <b>«Пропустить день»</b> — только если остались пропуски на неделе, после честного экрана «что ты теряешь» и 20 секунд на подумать.
            </li>
            <li>Время на отвлекающих сайтах тоже считается — увидишь на главной и в статистике.</li>
          </ol>
          <div className="divider" />
          <div className="muted" style={{ fontSize: 14 }}>
            Список отвлекающих сайтов и часы работы блокировки — в <b>Настройках</b>. Сайты для занятий и кнопку «Начать» — в настройках каждой привычки.
          </div>
        </section>

        <section className="card span-5">
          <div className="eyebrow">Установка · 2 минуты</div>
          <ol className="steps" style={{ marginTop: 14 }}>
            <li>
              Скачай папку <span className="kbd">extension</span> из репозитория (или весь репозиторий архивом).
            </li>
            <li>
              В Chrome открой <span className="kbd">chrome://extensions</span> и включи <b>«Режим разработчика»</b> справа сверху.
            </li>
            <li>
              <b>«Загрузить распакованное»</b> → выбери папку <span className="kbd">extension</span>.
            </li>
            <li>
              Открой настройки расширения, вставь адрес сайта: <span className="kbd">{location.origin}</span>
            </li>
            <li>
              Нажми <b>«Войти через Telegram»</b> — или создай токен ниже и вставь его.
            </li>
          </ol>
          <div className="divider" />
          <div className="row between wrap">
            <b>Токен для расширения</b>
            <button className="btn soft sm" onClick={create}>
              <Icon name="plus" size={14} /> Создать
            </button>
          </div>
          {token && (
            <div style={{ marginTop: 14 }}>
              <div className="codebox">{token}</div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => copy(token)}>
                  Скопировать
                </button>
                <span className="faint" style={{ fontSize: 12.5 }}>
                  Показывается один раз. Отозвать — в Настройках → Сессии.
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}
