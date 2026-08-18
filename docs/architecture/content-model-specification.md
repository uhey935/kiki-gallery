# Content Model Specification

Version: v1.2
Status: Approved
Last Updated: 2026-08-18

---

## 1. Overview and Content ID

本仕様は KiKi Gallery の Schema、Editor、Astro、および将来の CMS 実装における正式な Content Model の基準である。対象は Artist、Work、Exhibition、Journal、News、Home、About とする。

Collection 内で Content Unit を識別する公開上の識別子を **Content ID** とする。Shared／Localized 分離が有効な Content Unit では Content ID を Unit ディレクトリ名から導出し、`index.yaml`、`ja.md`、`en.md` のいずれにも重複保存しない。3ファイル形式は Collection ごとに承認・実装し、現在は Journal、Works、Artists、Exhibitions、Homeでcanonicalである。Aboutの同形式singletonはimplementation-ready targetであり、まだcurrent canonical runtimeではない。Home EditorもShared／JA／ENのthree-file lifecycleを実装済みであり、NewsはCollection固有の現行modelを維持する。

```text
Collection
└── Content ID
    ├── index.yaml
    ├── ja.md
    └── en.md
```

- Journal、Works、Artists、およびExhibitionsのthree-file Content Unitでは、Repository、Editor、および将来の CMS はディレクトリ名を Content ID の Single Source of Truth とする。
- Astro Adapter は導出した Content ID を locale-specific Entry の `entry.data.contentId` へ付与する。
- Astro の `entry.id` は Store 内で Entry を一意に参照するための内部 lookup key とする。Consumer はその文字列形式を解析せず、Content ID、Route、または外部 Reference として使用しない。
- Presentation、Route Helper、Map key、および Content Reference の解決は `entry.data.contentId`、または Repository／Editor 境界で同じ規則から導出した Content ID を基準にする。
- URL と Route は locale、collection、および Content ID から生成する Derived data とする。
- `slug` や Content ID を frontmatter へ重複保存しない。
- `visibility` の canonical field は Decisions 029–031 で責務と Journal matrix のみを承認済みとする。現行 strict Schema、migration、Site Content Service、および全 affected consumer を同じ実装 slice で変更するまでは保存 model へ追加しない。

保存構造と Astro Store の変換境界、Entry ID の生成規則、および Query／Route の責務は Loader Architecture Specification v1.0 に従う。

---

## 2. Design Principles

### 2.1 Shared / Localized / Derived

| Classification | Definition                                         | Examples                                                   |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Shared         | 言語に依存せず共通利用するデータ                   | ID、日付、Reference、画像Path、Enum、Presentation Metadata |
| Localized      | 言語ごとに保持するデータ                           | `title`、`summary`、`body`、`alt`、`biography`、`material` |
| Derived        | 保存せず Canonical data から表示時に生成するデータ | URL、表示タイトル、日付表示、展示状態、リンク先画像        |

Derived data は frontmatter へ保存しない。

### 2.2 Single Source of Truth

同じ意味の情報を複数の Collection や Field へ複製しない。所有元の Canonical data を Reference または表示時の算出によって再利用する。

- Work の内容は Work が所有する。
- Artist Detail における Work の順序と Layout は Artist が所有する。
- Exhibition と Artist の関係は Exhibition の `artists` が所有する。
- Home は参照先の Canonical data を複製しない。
- About statementとHome `about_intro`は相互に複製・fallbackしない。
- News の内部リンク先画像は Home 表示時に参照先から取得する。

### 2.3 Markdown, Editor, and Validation

- Markdown 本文に見出しを設ける場合は H1 を使わず H2 から開始する。H1 は Astro 側で描画する。
- 分類や Navigation に使用する制御語彙は英語固定とする。
- Editor は Content Model に従い、Editor 都合でモデルを変更しない。
- Build 時Validationを必須とし、不整合があれば公開Buildを失敗させる。
- Editor の正式設計は別フェーズで文書化する。

---

## 3. Hero Objects

Hero は Collection ごとに責務を分離し、暗黙に流用しない。

### 3.1 Artist Hero

```yaml
hero:
  image: /images/artists/example.webp
hero_alt: 作品の代替テキスト
```

| Field        | Classification | Required |
| ------------ | -------------- | -------- |
| `hero.image` | Shared         | Yes      |
| `hero_alt`   | Localized      | Yes      |

Artist 専用とし、Standard Hero の `orientation`、`position`、`treatment`、`hero_caption` は持たない。

### 3.2 Exhibition Hero

```yaml
hero:
  image: /images/exhibitions/example.webp
  orientation: landscape
  position: center
  treatment: cover
hero_alt: 展示画像の代替テキスト
hero_caption: Photo credit
```

| Field              | Classification | Required |
| ------------------ | -------------- | -------- |
| `hero.image`       | Shared         | Yes      |
| `hero.orientation` | Shared         | Yes      |
| `hero.position`    | Shared         | No       |
| `hero.treatment`   | Shared         | No       |
| `hero_alt`         | Localized      | Yes      |
| `hero_caption`     | Localized      | No       |

Allowed values:

- `orientation`: `portrait`, `landscape`
- `position`: `top`, `center`, `bottom`, `left`, `right`
- `treatment`: `default`, `contain`, `cover`

### 3.3 Journal Hero

```yaml
hero:
  image: /images/journal/example.webp
  hero_caption: Photo credit
hero_alt: 記事画像の代替テキスト
```

| Field               | Classification | Required |
| ------------------- | -------------- | -------- |
| `hero.image`        | Shared         | Yes      |
| `hero.hero_caption` | Shared         | No       |
| `hero_alt`          | Localized      | Yes      |

`orientation`、`position`、`treatment` は禁止する。

### 3.4 Home Hero

```yaml
home_hero:
  media:
    type: image
    image: /images/home/example.webp
```

`home_hero` は Home 専用の Optional Object であり、画像と動画に対応する。

| Field          | Required                  | Rule                         |
| -------------- | ------------------------- | ---------------------------- |
| `media`        | Yes when Home Hero exists | Home Hero media              |
| `media.type`   | Yes                       | `image` or `video`           |
| `media.image`  | Conditional               | `type: image` で必須         |
| `media.video`  | Conditional               | `type: video` で必須         |
| `media.poster` | Conditional               | `type: video` のときのみ任意 |
| `layout`       | Prohibited                | obsolete field               |

- 未設定時は表示実装で `/images/home/fallback-hero.webp` を使用する。
- Fallback 専用Fieldは保存しない。
- Exhibition HeroをHome Heroとして流用しない。

---

## 4. Artist and Work Layout

### 4.1 Artist Fields

Shared:

| Field                    | Type              | Required    |
| ------------------------ | ----------------- | ----------- |
| `sort_name`              | String            | Yes         |
| `hero.image`             | String            | Yes         |
| `medium`                 | English String[]  | Yes         |
| `works_layout`           | Work Layout[]     | No          |
| `works_layout[].works[]` | Work Content ID[] | Conditional |

Localized:

| Field         | Type   | Required |
| ------------- | ------ | -------- |
| `name`        | String | Yes      |
| `hero_alt`    | String | Yes      |
| `short_bio`   | String | Yes      |
| `biography`   | String | No       |
| `seo_title`   | String | No       |
| `description` | String | No       |

Rules:

- `medium` は Required の英語配列で、1件以上を必要とする。
- `works_layout` は Optional とする。
- `works_layout[].works[]` は Work Content ID を保持し、localized Artist Entry ID を保持しない。
- Artist は Work や Exhibition の Canonical data を重複所有しない。
- Exhibition 一覧は Exhibition の `artists` から Derived する。
- `sort_name` は Shared の並び順・canonical英字名、`name` は各localeの表示名とする。
- JA／EN間のruntime fallbackは禁止する。EN placeholderはEN capabilityだけをblockする。

### 4.2 Work Layout

```yaml
works_layout:
  - layout: double-a
    works:
      - work-a
      - work-b
```

Field 名は `layout` とする。Allowed values:

- `single-a`
- `single-b`
- `double-a`
- `double-b`

Rules:

- `single-a` / `single-b` は Work 1件、`double-a` / `double-b` は Work 2件を参照する。
- 同一 Artist Detail 内で同じ Work を複数回参照しない。
- 参照 Work の所属 Artist と参照元 Artist が一致しなければならない。
- 参照切れ・所属不一致は Cross-collection validation で Build を失敗させる。

---

## 5. Work

Work は Hero を持たず、`images[0]` を代表画像として使用する。

Shared:

| Field         | Type                | Required |
| ------------- | ------------------- | -------- |
| `artist`      | Artist Reference    | Yes      |
| `images`      | Shared Work Image[] | Yes      |
| `year`        | Positive Integer    | No       |
| `orientation` | Enum                | No       |
| `inquiry`     | Inquiry             | Yes      |

Localized:

| Field         | Type                   | Required |
| ------------- | ---------------------- | -------- |
| `title`       | String                 | Yes      |
| `images`      | Localized Work Image[] | Yes      |
| `material`    | String                 | No       |
| `size`        | String                 | No       |
| `description` | String                 | No       |
| `seo_title`   | String                 | No       |
| Markdown body | Markdown               | No       |

```yaml
images:
  - src: /images/works/example.webp
    alt: 作品画像の代替テキスト
```

Rules:

- `images` は1件以上。Worksのcanonical three-file構成ではShared `images[].src` とLocalized `images[].alt` をindex対応させ、件数不一致をfail-closedとする。
- 同一 Work 内で同じ `src` を重複させない。
- Worksでは`src`はShared、`alt`はLocalizedとし、persistent image IDは導入しない。
- `size` と `material` はLocalized Optionalとし、現在のJA表示文字列をnormalizeせず移行する。
- Work は `medium` を持たない。
- `orientation` は Optional で、現時点では `landscape` のみ許可する。
- `images.length === 1 && orientation === "landscape"` の場合に専用表示を使用する。
- 画像寸法から `orientation` を自動推論しない。

### 5.1 Inquiry

```yaml
inquiry:
  type: inquiry
```

```yaml
inquiry:
  type: shop
  url: https://example.com/item
```

```yaml
inquiry:
  type: none
```

- Inquiry Object は Required。
- `shop` は URL 必須、`inquiry` は URL 任意、`none` は URL 禁止とする。
- Boolean は使用しない。

---

## 6. Exhibition

Shared:

| Field              | Type               | Required |
| ------------------ | ------------------ | -------- |
| `artists`          | Artist Reference[] | Yes      |
| `start_date`       | Date               | Yes      |
| `end_date`         | Date               | Yes      |
| `hero`             | Exhibition Hero    | Yes      |
| `works`            | Work Reference[]   | No       |
| `display_artists`  | Boolean            | No       |
| `hero.image`       | String             | Yes      |
| `hero.orientation` | Enum               | Yes      |
| `hero.position`    | Enum               | No       |
| `hero.treatment`   | Enum               | No       |

Localized:

| Field           | Type     | Required |
| --------------- | -------- | -------- |
| `title`         | String   | Yes      |
| `summary`       | String   | No       |
| `hero_alt`      | String   | Yes      |
| `hero_caption`  | String   | No       |
| `venue`         | String   | No       |
| `opening_hours` | String   | No       |
| `closed_days`   | String   | No       |
| `attendance`    | String   | No       |
| `seo_title`     | String   | No       |
| `description`   | String   | No       |
| Markdown body   | Markdown | No       |

Rules:

- `artists` は Required で1件以上を必要とし、Content ID は重複不可とする。
- `start_date` / `end_date` は両方 Required で、`end_date >= start_date` とする。
- `title` / `hero_alt` は Required Localized String、`summary` / `venue` / `opening_hours` / `closed_days` / `attendance` / `hero_caption` / `seo_title` / `description` は Optional Localized String とする。
- `works` は Optional Work Reference 配列で、Content ID は重複不可とする。
- `display_artists` は Optional で、未指定時は表示する。
- `hero.image` / `hero.orientation` は Required、`hero.position` / `hero.treatment` は Optional Shared presentation fieldsとする。
- `status` は日付から Derived し、保存しない。
- Artist display nameを保存する旧`artist_name` fieldは持たず、`artists[]`のcanonical Content IDからlocaleごとに解決する。
- `title` は必ずlocale sourceに保存し、Artist名から個展・合同展タイトルを生成しない。
- `seo_title` / `description` がない場合のProduction metadataは決定的な表示policyに従うが、migration・Save・runtimeはSEO文章をcanonical sourceへ生成しない。
- 参照 Artist / Work の存在と、表示Workの所属Artistが `artists` に含まれることを検証する。

---

## 7. Journal

Shared:

| Field        | Type                | Required |
| ------------ | ------------------- | -------- |
| `date`       | `YYYY-MM-DD` String | Yes      |
| `categories` | Enum[]              | Yes      |
| `hero`       | Journal Hero        | Yes      |
| `author`     | Contributor ID      | No       |
| `credits`    | Credit[]            | No       |

Localized:

| Field         | Type     | Required |
| ------------- | -------- | -------- |
| `title`       | String   | Yes      |
| `summary`     | String   | Yes      |
| `hero_alt`    | String   | Yes      |
| Markdown body | Markdown | No       |

Allowed categories:

- `interview`
- `essay`
- `report`

Rules:

- `date` は Required の有効な `YYYY-MM-DD` 文字列。
- `categories` は Required で1件以上、`summary` は Required。
- `author` / `credits` は両方 Optional で、同時指定は禁止する。
- Credit は Required の `role` と、`person` または `member` の一方を持つ。両方の同時指定は禁止する。
- `hero_caption` の画像クレジットを Contributor Credits へ移さない。

---

## 8. News

News は短い告知モデルであり、Hero、画像、長文本文、Detail Page を持たない。

Shared:

| Field          | Type                         | Required |
| -------------- | ---------------------------- | -------- |
| `date`         | `YYYY-MM-DD` String          | Yes      |
| `news_type`    | Enum                         | Yes      |
| `link`         | Internal Path or HTTP(S) URL | No       |
| `show_on_home` | Boolean                      | Yes      |

Localized:

| Field     | Type   | Required |
| --------- | ------ | -------- |
| `title`   | String | Yes      |
| `summary` | String | No       |

Allowed `news_type` values:

- `exhibition`
- `artist`
- `general`

Rules:

- `date` は Required の有効な `YYYY-MM-DD` 文字列。
- `news_type` / `title` は Required、`summary` / `link` は Optional。
- `show_on_home` は Required Boolean。
- `link` は `/` で始まる内部Path、または `http://` / `https://` URLに限定する。
- News は `hero`、`image`、`body`、Detail Page を持たず、`/news/{id}` Route は生成しない。
- 内部リンク先の画像と代替テキストは Home 表示時に Derived する。
- `has_page`、`featured`、`published_at` は持たない。

Home 掲載条件:

1. `show_on_home === true`
2. `link` が存在する。
3. 既知の内部リンク先を解決できる。
4. 参照先から Derived 画像を取得できる。

外部URL、一般Path、画像を解決できないリンクは Home Stories へ掲載しない。既知Collectionを指す内部リンクの参照切れはBuildを失敗させる。

---

## 9. Home

Home は Navigation / Composition Layer であり、独立した記事 Collection ではない。

### 9.1 Historical corrected flat runtime

以下はmigration evidenceに保存されたhistorical flat modelであり、現在の
Production canonical sourceではない。

| Field         | Type           | Required |
| ------------- | -------------- | -------- |
| `home_hero`   | Home Hero      | No       |
| `sections`    | Home Section[] | Yes      |
| `title`       | String         | No       |
| `description` | String         | No       |

Home Section:

| Field       | Type                      | Required |
| ----------- | ------------------------- | -------- |
| `id`        | String                    | Yes      |
| `title`     | English Navigation String | Yes      |
| `href`      | Internal Path or URL      | Yes      |
| `image.src` | Image Path                | Yes      |

Rules:

- `home_hero` は Optional。
- `title` は Shared の英語 Navigation Language。
- 現在の表示実装は `artists` → `about` の固定構成を維持し、配列順をsemantic authorityとして扱わない。`id` は同一 Home Entry 内で一意とする。
- 各Sectionは現在の表示が使用する単一のCanonical Imageを`image.src`として所有する。Responsive derivativeやsource switchingは現行modelに含めない。
- 参照先 Collection の Canonical data を Home へ複製しない。
- Fallback Hero は表示ロジック側で `/images/home/fallback-hero.webp` を使用する。

### 9.2 Current localized Production model

TargetはContent ID `home`のsingleton
`src/content/home/home/{index.yaml,ja.md,en.md}`である。exact three-file
inventoryを要求し、missing、extra、symlink、legacy flat sourceとの混在を
fail-closedにする。Create、Rename、Deleteは持たない。

`index.yaml`はShared hero mediaと、named objectとして固定されたArtists →
About sectionsを所有する。Section destinationは`artists` / `about`の論理ID、
画像はそれぞれ`/images/home/artists-square.jpg`と
`/images/home/about-landscape.jpg`である。Responsive variantsは持たず、
obsoleteな`home_hero.layout`も持たない。

`ja.md`と`en.md`はrequired `about_intro`、optional `seo_title`、optional
`description`のみを所有し、Markdown bodyやdecorative image alt fieldsを
持たない。Locale fallbackはなく、Shared、localized source、assets、required
destination routes、route projectionがすべてvalidなlocaleだけがHome routeを
生成できる。

完全なschema、capability、route/Editor/migration契約は
[Home Localization Architecture](./home-localization-architecture-2026-08-12.md)
をcurrent Production authorityとする。MigrationとProduction cutoverは完了済み
だが、temporary JA copyの正式化とEN capabilityは未完了である。Home Editorの
Shared／JA／EN Load、Preview、Save、Publishは実装済みである。

---

## 10. About — implementation-ready target

AboutはContent ID `about`のsingletonであり、target topologyは
`src/content/about/about/{index.yaml,ja.md,en.md}`である。Missing、extra、
symlink、non-regular、mixed legacy canonical stateをfail-closedにし、Create、
Rename、Deleteを持たない。現行Productionは引き続きhard-coded
`src/pages/about.astro`を使用するため、本節はcurrent runtime authorityではない。

`index.yaml`はdecorative hero source、順序付き4件のgallery source、承認状態を
含むstructured weekly hours、optional `email` / `map_url` /
`instagram_url`を所有する。Phoneやgeneric social arrayは持たない。Hoursの
`pending`状態は実値を持たずformal capabilityを許可しない。`approved`状態は
timezone、open weekdays、open/close time、closed weekdaysを要求し、localized
display copyはlocale presenterからDerivedする。

`ja.md`と`en.md`はlocale content status、display address、順序対応する4件の
gallery alt、optional `seo_title` / `description`、およびrequired Markdown
statement bodyを所有する。Heroはdecorativeのためlocalized altを持たない。
Shared gallery source countと各locale alt countは4で一致し、duplicate source、
empty/placeholder alt、slot mismatchを拒否する。

Formal locale capabilityはsafe/valid exact unit、approved Shared hours、approved
locale content、address、statement、4 alts、required five assets、およびroute
projectionを要求する。SEOとoptional contactのabsenceはblockerではない。
Locale fallbackはなく、non-capable localeのrouteは生成しない。RoutesはJA
`/about/`、EN `/en/about/`である。

About EN capabilityはHome ENのAbout destination availabilityへ一方向に供給する。
Home `about_intro`はHome-owned editorial contentのままであり、About bodyを再利用
しない。Headerは将来のsite-wide capability-aware route projectionを利用し、
counterpart不在時にlocale routeをhard-codeしない。

Editor targetはShared／JA／ENのsingleton Load、locale-isolated Preview、atomic
three-file Save、exact-evidence Publishであり、Create／Rename／Deleteを持たない。
Legacy `GALLERY crossing` statementはhistorical migration evidenceとしてのみ保持し、
current JA statementへ自動移行しない。完全なtarget schema、capability、Editor、
migration、asset invariance契約は
[About Localization Architecture](./about-localization-architecture-2026-08-18.md)
をimplementation-ready authorityとする。

---

## 11. Validation

Schema は Unknown Field を拒否する strict Schema とし、次を検証する。

- Required / Optional / Conditional
- Enum
- Reference Exists
- Unique
- Optional XOR
- Cross-field validation
- Cross-collection validation
- 空配列禁止、日付形式・順序、配列内重複

Cross-collection validation:

- Collection Reference が保持する論理 ID を、参照先 Entry の `entry.data.contentId`、または Repository 境界で導出した同等の Content ID として解決できること。Astro `entry.id` の encoding には依存しない。
- Artist–Work参照切れ、所属一致、Artist Detail内Work重複。
- Workが参照するArtistの存在。
- Exhibitionが参照するArtist / Workの存在と所属整合。
- Newsの既知の内部リンク先をHome画像解決時に参照できること。

Validation error がある場合、公開 Build を失敗させる。

---

## 11. Change Management

- 本仕様を Schema、Editor、Astro 実装の正式な基準とする。
- Content Model 変更時は仕様書と実装を同期する。
- Content Unit の保存形式や Astro Entry ID の encoding を変更しても、ディレクトリ名から導出する Content ID の責務を変えない。
- 新しいFieldは既存FieldまたはDerived dataで表現できない場合にのみ追加する。
- 未確定の抽象ObjectやEnumを先回りして追加しない。
- Editor設計は別フェーズで正式文書化する。
- 後方互換性を壊す変更はMigrationとして扱い、仕様書、Schema、コンテンツ、表示、Validationを同じ変更単位で更新する。
