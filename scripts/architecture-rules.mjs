const layers = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
function webLocation(file) {
  if (!file.startsWith('apps/web/src/')) return null;
  const parts = file.slice('apps/web/src/'.length).split('/');
  const [layer, slice] = parts;
  const unit =
    layer === 'app'
      ? 'app'
      : layer === 'shared' && slice === 'ui'
        ? parts.slice(0, 3).join('/')
        : parts.slice(0, 2).join('/');
  return { layer, slice, unit, parts };
}
function packageName(file) {
  return /^packages\/([^/]+)\//.exec(file)?.[1];
}
export function checkImport(from, to, specifier) {
  const sourcePackage = packageName(from),
    targetPackage = packageName(to);
  const source = webLocation(from),
    target = webLocation(to);
  if (
    sourcePackage &&
    (to.startsWith('apps/') || (targetPackage && sourcePackage !== targetPackage))
  )
    return 'Общие пакеты изолированы от приложений и друг друга.';
  if (from.startsWith('apps/apps-script/') && target) return 'Apps Script не импортирует web.';
  if (source && to.startsWith('apps/apps-script/')) return 'Web не импортирует Apps Script.';
  if (
    targetPackage &&
    !sourcePackage &&
    !/^@tastory\/(contracts|domain|design-tokens)$/.test(specifier)
  )
    return 'Используйте public API workspace-пакета.';
  if (
    source &&
    targetPackage === 'domain' &&
    !(['features', 'entities'].includes(source.layer) && source.parts[2] === 'model')
  )
    return 'Domain доступен только model-сегментам entities/features.';
  if (
    source &&
    targetPackage === 'contracts' &&
    source.layer !== 'app' &&
    !source.parts.includes('api') &&
    !source.parts.includes('model')
  )
    return 'Contracts доступны только api/model и app.';
  if (!source || !target) return null;
  if (!layers.includes(source.layer) || !layers.includes(target.layer))
    return 'Неизвестный слой FSD.';
  if (source.unit === target.unit)
    return specifier.startsWith('@/') ? 'Внутри слайса используйте относительный импорт.' : null;
  if (
    !(source.layer === 'shared' && target.layer === 'shared') &&
    layers.indexOf(target.layer) <= layers.indexOf(source.layer)
  )
    return 'Импорт разрешен только в нижний слой FSD.';
  if (!specifier.startsWith('@/')) return 'Между слайсами используйте alias @/.';
  if (!/\/index\.tsx?$/.test(to)) return 'Deep import запрещен: используйте index.ts public API.';
  return null;
}
export function checkExternal(from, specifier) {
  if (/\.test\.[cm]?[jt]sx?$/.test(from) && specifier === 'vitest') return null;
  const name = packageName(from);
  if (name && !(name === 'contracts' && specifier === 'zod'))
    return 'Общий пакет не должен зависеть от платформенных runtime-модулей.';
  return null;
}
