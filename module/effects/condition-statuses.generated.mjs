// Generated from packs/_source/conditions by scripts/generate-condition-statuses.mjs.
// Do not edit: change the approved source card and regenerate.
export const CONDITION_STATUSES = {
  "fnri7-unconscious": {
    "name": "Без сознания",
    "img": "icons/creatures/eyes/humanoid-single-blind.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-unconscious"
    ],
    "description": "Существо **Не может действовать** и остаётся Сбитым с ног.\n\nСостояние заканчивается, когда существо возвращается в сознание.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "unconscious",
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-unconscious",
    "hud": true
  },
  "fnri7-partial-cover": {
    "name": "Частичное укрытие",
    "img": "icons/skills/melee/shield-block-gray-orange.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-partial-cover"
    ],
    "description": "При направленной атаке по этой цели применяется Штраф помехи −4.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "partial-cover",
        "rulesRef": "rulebook.md#штрафы-помехи"
      }
    },
    "id": "fnri7-partial-cover",
    "hud": true
  },
  "fnri7-frightened": {
    "name": "Напуган",
    "img": "icons/magic/control/fear-fright-mask-orange.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-frightened"
    ],
    "description": "Результат всех проверок `d20` Напуганного существа уменьшается на `2`, кроме проверок, единственная цель которых — прекратить действующий эффект.\n\nЭто **не Штраф**. Натуральная `20` остаётся натуральной `20` и по обычному правилу означает Большой успех. Натуральная `1` остаётся натуральной `1`.\n\nПроверки прекращения Напуган, Ослаблен, Замедлен, Обездвижен, Периодических эффектов и другие проверки снятия эффектов выполняются без этого уменьшения.\n\nЕсли источник не указывает отдельное завершение, состояние заканчивается по общему правилу завершения длительных эффектов.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "frightened",
        "requiresManualResolution": true,
        "effectEnding": "general",
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-frightened",
    "hud": true
  },
  "fnri7-cannotact": {
    "name": "Не может действовать",
    "img": "icons/skills/social/wave-halt-stop.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-cannotact"
    ],
    "description": "Существо, которое **не может действовать**, не совершает Движений, Воздействий, Вмешательств, свободных действий и действий без указанной цены. Уже начатое действие также прекращается.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "cannotact",
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-cannotact",
    "hud": true
  },
  "fnri7-invisible": {
    "name": "Невидимость",
    "img": "icons/magic/perception/shadow-stealth-eyes-purple.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-invisible"
    ],
    "description": "По известной или выбранной клетке Невидимой цели направленная атака получает Штраф помехи −10. Невидимое для цели существо не учитывается среди угроз при расчёте её Окружения. При атаке Невидимого существа его цель считается Застигнутой врасплох относительно этой атаки.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "invisible",
        "rulesRef": "rulebook.md#штрафы-помехи"
      }
    },
    "id": "fnri7-invisible",
    "hud": true
  },
  "fnri7-immobilized": {
    "name": "Обездвижен",
    "img": "icons/magic/control/debuff-chains-shackle-movement-red.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-immobilized"
    ],
    "description": "Существо не может совершать действия со свойством **Движение**. Это не запрещает Телепортацию: действие Телепортации можно совершить, если выполнены все остальные его требования. Действия без свойства Движение остаются доступными.\n\nЕсли источник не указывает отдельное завершение, состояние заканчивается по общему правилу завершения длительных эффектов.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "immobilized",
        "requiresManualResolution": true,
        "effectEnding": "general",
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-immobilized",
    "hud": true
  },
  "fnri7-stunned": {
    "name": "Оглушён",
    "img": "icons/skills/wounds/injury-face-impact-orange.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-stunned"
    ],
    "description": "Оглушение действует мгновенно и не остаётся на цели как длительное состояние.\n\n**Наложено вмешательством в активный ход цели:** текущее действие прерывается; затем цель теряет одно оставшееся использование движения, воздействия или вмешательства по своему выбору. Следующее восстановление не уменьшается.\n\n**Наложено действием источника в его ход:** цель немедленно теряет одно оставшееся использование; в начале следующего хода восстанавливает на одно использование меньше по своему выбору.\n\nДо начала следующего хода дополнительные Оглушения не отнимают ещё один ресурс и не уменьшают восстановление повторно. Однако Оглушение, наложенное вмешательством, каждый раз может прервать новое текущее действие.\n\n---",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "stunned",
        "informationalMarker": true,
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#оглушён"
      }
    },
    "id": "fnri7-stunned",
    "hud": true
  },
  "fnri7-weakened": {
    "name": "Ослаблен",
    "img": "icons/magic/death/hand-withered-gray.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-weakened"
    ],
    "description": "После применения Защит уменьшите на `2` итоговый физический урон от атак оружием ближнего боя, Безоружных атак и атак оружием категории **Луки**.\n\nЕсли источник не указывает отдельное завершение, состояние заканчивается по общему правилу завершения длительных эффектов.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "weakened",
        "requiresManualResolution": true,
        "effectEnding": "general",
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-weakened",
    "hud": true
  },
  "fnri7-poor-visibility": {
    "name": "Плохая видимость",
    "img": "icons/magic/air/fog-gas-smoke-dense-blue.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-poor-visibility"
    ],
    "description": "При направленной атаке по этой цели применяется Штраф помехи −4.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "poor-visibility",
        "rulesRef": "rulebook.md#штрафы-помехи"
      }
    },
    "id": "fnri7-poor-visibility",
    "hud": true
  },
  "fnri7-sustained": {
    "name": "Поддерживаемое",
    "img": "icons/magic/control/energy-stream-link-spiral-teal.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-sustained"
    ],
    "description": "**Поддерживаемый** эффект действует не более 10 раундов. Если создавшее его существо использует Вмешательство, эффект заканчивается после завершения этого Вмешательства.\n\nОдновременно могут действовать несколько Поддерживаемых эффектов одного источника. Одно Вмешательство источника заканчивает их все.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "sustained",
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-sustained",
    "hud": true
  },
  "fnri7-prone": {
    "name": "Сбит с ног",
    "img": "icons/magic/control/silhouette-fall-slip-prone.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-prone"
    ],
    "description": "Существо лежит, застигнуто врасплох, не создаёт угрозу, не входит в строй и считается пересечённой местностью для прохода через его клетку.\n\nСостояние прекращается действием [«Встать»](#встать).",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "prone",
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-prone",
    "hud": true
  },
  "fnri7-darkness": {
    "name": "Темнота",
    "img": "icons/magic/light/orb-shadow-blue.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-darkness"
    ],
    "description": "Освещённость задаётся вручную. −10 при обычном зрении, −4 при Сумеречном зрении, нет штрафа при Зрении в темноте.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "darkness",
        "rulesRef": "rulebook.md#штрафы-помехи"
      }
    },
    "id": "fnri7-darkness",
    "hud": true
  },
  "fnri7-dim-light": {
    "name": "Тусклый свет",
    "img": "icons/magic/time/day-night-sunset-sunrise.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-dim-light"
    ],
    "description": "Освещённость задаётся вручную. −4 при обычном зрении, нет штрафа при Сумеречном зрении или Зрении в темноте.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "dim-light",
        "rulesRef": "rulebook.md#штрафы-помехи"
      }
    },
    "id": "fnri7-dim-light",
    "hud": true
  },
  "fnri7-grabbed": {
    "name": "Захвачен",
    "img": "icons/skills/melee/unarmed-punch-fist.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-grabbed"
    ],
    "description": "Существо застигнуто врасплох, не входит в Строй, не может использовать действия со свойством **Движение**.\n\nЗахват заканчивается в начале следующего хода удерживающего существа.\n\nВ свой ход удерживающее существо может свободным действием добровольно закончить любой свой Захват.\n\nЗахват заканчивается, если удерживающее или удерживаемое существо перемещается. Использование Вмешательства заканчивает все Захваты, удерживаемые этим существом, кроме Противодействия против **«Вырваться»** или **«Освободить союзника»**: оно не заканчивает Захват, против которого используется.\n\nРука или оружие, использованные для Захвата, заняты удержанием цели. При Захвате двуручным оружием удерживающее существо не может атаковать или полноценно использовать это оружие.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "grabbed",
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-grabbed",
    "hud": true
  },
  "fnri7-slowed": {
    "name": "Замедлен",
    "img": "icons/magic/movement/chevrons-down-yellow.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-slowed"
    ],
    "description": "Скорость существа уменьшается **вдвое**. Если получается дробное значение, примените глобальное округление вниз.\n\nЕсли источник не указывает отдельное завершение, состояние заканчивается по общему правилу завершения длительных эффектов.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "slowed",
        "requiresManualResolution": true,
        "effectEnding": "general",
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-slowed",
    "hud": true
  },
  "fnri7-offguard": {
    "name": "Застигнут врасплох",
    "img": "icons/skills/melee/shield-damaged-broken-blue.webp",
    "type": "base",
    "showIcon": 2,
    "statuses": [
      "fnri7-offguard"
    ],
    "description": "Существо получает `−2` ко всем трём порогам КЗ и ко всем защитным характеристикам: Внимательности, Рефлексу, Стойкости и Воле. Несколько причин состояния не складываются.\n\nШтраф к защитным характеристикам применяется везде, где используется их текущее значение, включая Сложность направленных проверок и проверки Защитных действий, которые добавляют соответствующую характеристику.",
    "transfer": false,
    "disabled": false,
    "duration": {},
    "system": {
      "changes": []
    },
    "flags": {
      "fast-nri-v14": {
        "conditionId": "offguard",
        "requiresManualResolution": true,
        "rulesRef": "rulebook.md#состояния"
      }
    },
    "id": "fnri7-offguard",
    "hud": true
  }
};
export const CONDITION_CARD_LINKS = {
  "unconscious": {
    "name": "Без сознания",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci2q524g8i0pfac"
  },
  "partial-cover": {
    "name": "Частичное укрытие",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci023hzod5kbmxr"
  },
  "frightened": {
    "name": "Напуган",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci0nffr44waqv55"
  },
  "cannotact": {
    "name": "Не может действовать",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci1z8fppwflzs16"
  },
  "invisible": {
    "name": "Невидимость",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci14jjkldgk4hwb"
  },
  "immobilized": {
    "name": "Обездвижен",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci1mjs4amcfzzjs"
  },
  "stunned": {
    "name": "Оглушён",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci0emyooab7hd3o"
  },
  "weakened": {
    "name": "Ослаблен",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci2pzwaekhrzrbp"
  },
  "poor-visibility": {
    "name": "Плохая видимость",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci3hu01kgxuso5j"
  },
  "sustained": {
    "name": "Поддерживаемое",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci2g4re094jfs3n"
  },
  "prone": {
    "name": "Сбит с ног",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci2rk9h5dhorhvh"
  },
  "darkness": {
    "name": "Темнота",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci13nrnmvxwpyf5"
  },
  "dim-light": {
    "name": "Тусклый свет",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci1g67y9hu5ao5j"
  },
  "grabbed": {
    "name": "Захвачен",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci2bgli389iqpf6"
  },
  "slowed": {
    "name": "Замедлен",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci06z8101cy2waz"
  },
  "offguard": {
    "name": "Застигнут врасплох",
    "uuid": "Compendium.fast-nri-v14.conditions.Item.fci0rcmfnx30sgox"
  }
};
