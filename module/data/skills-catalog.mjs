/** Verified Basic Skills from Fast NRI Rulebook 7.0.
 * Temporary built-in catalogue until selectable external content JSON exists.
 * A catalogue entry is a template; an Actor owns its own copied skill record.
 */
export const BASIC_SKILLS = Object.freeze(
[
  {
    "id": "acrobatics",
    "name": "Акробатика",
    "group": "physical",
    "description": "Равновесие, перекаты, безопасные падения, движение по узким или неустойчивым поверхностям, Проскользнуть и освобождение из Захвата за счёт ловкости."
  },
  {
    "id": "athletics",
    "name": "Атлетика",
    "group": "physical",
    "description": "Лазание, плавание, прыжки, поднятие тяжестей, длительное физическое усилие, боевые манёвры и освобождение из Захвата силой."
  },
  {
    "id": "stealth",
    "name": "Скрытность",
    "group": "physical",
    "description": "Бесшумное движение, укрытие от наблюдения, подготовка засады и сохранение незаметности."
  },
  {
    "id": "sleight_of_hand",
    "name": "Ловкость рук",
    "group": "physical",
    "description": "Карманные кражи, замки, ловушки, тонкая работа пальцами и незаметные манипуляции с небольшими предметами."
  },
  {
    "id": "survival",
    "name": "Выживание",
    "group": "practical",
    "description": "Ориентирование, чтение следов, поиск пути и припасов, устройство лагеря, знание погоды и безопасное путешествие по дикой местности."
  },
  {
    "id": "medicine",
    "name": "Медицина",
    "group": "practical",
    "description": "Диагностика ран и болезней, Первая помощь, уход за пострадавшими и иные медицинские действия, предусмотренные конкретными правилами."
  },
  {
    "id": "craft",
    "name": "Ремесло",
    "group": "practical",
    "description": "Изготовление, ремонт и оценка предметов, работа с инструментами, механизмами, материалами и техническими устройствами."
  },
  {
    "id": "nature",
    "name": "Природа",
    "group": "magical",
    "description": "Стихии и природные явления, интуитивная связь с живым миром, животные и растения, природные духи и манипуляции жизненной силой."
  },
  {
    "id": "religion",
    "name": "Религия",
    "group": "magical",
    "description": "Боги и покровители, священные обряды, культы, благословения и проклятия, души, посмертие, небесные и нечестивые существа."
  },
  {
    "id": "mysticism",
    "name": "Мистика",
    "group": "magical",
    "description": "Непознанное и оккультное, сны и видения, чуждые сущности, эмоции, память, восприятие и манипуляции сознанием."
  },
  {
    "id": "arcana",
    "name": "Аркана",
    "group": "magical",
    "description": "Магические формулы и руны, устройство заклинаний и артефактов, управление энергией, температурой и материей."
  },
  {
    "id": "society",
    "name": "Общество",
    "group": "social",
    "description": "История, культура, законы, государства, народы, организации, обычаи и устройство разумных сообществ."
  },
  {
    "id": "persuasion",
    "name": "Убеждение",
    "group": "social",
    "description": "Честные доводы, переговоры, поиск компромисса, поддержка доверия и склонение собеседника к сотрудничеству."
  },
  {
    "id": "deception",
    "name": "Обман",
    "group": "social",
    "description": "Ложь, притворство, маскировка намерений, отвлечение внимания, Отвлечение и введение собеседника в заблуждение."
  },
  {
    "id": "intimidation",
    "name": "Запугивание",
    "group": "social",
    "description": "Угрозы, давление, демонстрация превосходства и Деморализация противника."
  }
].map(skill => Object.freeze(skill)));

export const SKILL_GROUPS = Object.freeze(["physical", "practical", "magical", "social"]);
export const BASIC_SKILLS_BY_ROW_ID = new Map(BASIC_SKILLS.map(skill => [`core_${skill.id}`, skill]));

export function standardSkillEntry(skill) {
  return { name: skill.name, kind: "skill", catalogId: skill.id, dice: "", modifier: null, value: null };
}

export function initialSkillEntries() {
  return {
    ...Object.fromEntries(BASIC_SKILLS.map(skill => [`core_${skill.id}`, standardSkillEntry(skill)])),
    starter_primary: { name: "", kind: "specialization", catalogId: "", dice: "2d6", modifier: null, value: null },
    starter_secondary: { name: "", kind: "specialization", catalogId: "", dice: "2d4", modifier: null, value: null }
  };
}
