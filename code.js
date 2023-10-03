function getSpreadSheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getRoutesData(spreadSheet) {
  let sheet = spreadSheet.getSheetByName("routes");
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();
}

function getRoutesJpData(spreadSheet) {
  let sheet = spreadSheet.getSheetByName("routes_jp");
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues();
}

function getExpressBusData(spreadSheet) {
  let sheet = spreadSheet.getSheetByName("ExpressBus");
  let data = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues();
  // 1行分しかデータがないので，1次元リストにして返却
  return data[0];
}

function getRouteLongName(routeId) {
  let routesData = getRoutesData(getSpreadSheet());
  return search(routeId, routesData, 3);
}

function getRouteShortName(routeId) {
  let routesData = getRoutesData(getSpreadSheet());
  return search(routeId, routesData, 2);
}

function search(param, target, returnColumnId) {
  for (let i = 0; i < target.length; i++) {
    if (target[i][0].includes(param)) {
      return target[i][returnColumnId];
    }
  }
  return "無効路線";
}

function getGtfsData() {
  // 運行情報取得
  let response = UrlFetchApp.fetch(
    "https://loc.bus-vision.jp/realtime/ryobi_trip_update.bin"
  );
  return response.getContentText();
}

function saveTextFile(contents) {
  const folderId = "";

  // 時刻取得
  let result = getDateString("yyyy_MM_dd_HH_mm_ss");

  // 出力するファイル名
  const fileName = "ryobi_trip_update_" + result + ".bin";

  // コンテンツタイプ
  const contentType = "text/plain";

  // 文字コード
  const charset = "UTF-8";

  // 出力するフォルダ
  const folder = DriveApp.getFolderById(folderId);

  // Blob作成
  const blob = Utilities.newBlob("", contentType, fileName).setDataFromString(
    contents,
    charset
  );

  // ファイルに保存
  folder.createFile(blob);
}

function getDateString(format) {
  // 指定の体裁で時刻取得
  let date = new Date();
  return Utilities.formatDate(date, "GMT+9", format).toString();
}

function notifyToDiscord(messtr) {
  // discord側で作成したボットのウェブフックURL
  const discordWebHookURL =
    "";

  // 時刻取得
  let result = getDateString("[yyyy/MM/dd HH:mm:ss] ");

  // 投稿するチャット内容と設定
  const message = {
    content: result + messtr, // チャット本文
    tts: false, // ロボットによる読み上げ機能を無効化
  };

  const param = {
    method: "POST",
    headers: { "Content-type": "application/json" },
    payload: JSON.stringify(message),
  };

  UrlFetchApp.fetch(discordWebHookURL, param);
}

// busDataList: [[route_id, departure_time, バス号車番号] xN]
function notify(busDataList) {
  let spreadSheet = getSpreadSheet();
  let routesData = getRoutesData(spreadSheet);
  let routesJpData = getRoutesJpData(spreadSheet);
  let expressBusData = getExpressBusData(spreadSheet);

  let result = getDateString("yyyyMMdd");

  // シート存在チェック
  let writeSheet = spreadSheet.getSheetByName(result);
  if (writeSheet === null) {
    // ない場合は作成
    writeSheet = spreadSheet.insertSheet();
    writeSheet.setName(result);
  }

  let accumulatedData = [];
  if (writeSheet.getLastRow() > 0) {
    accumulatedData = writeSheet
      .getRange(1, 1, writeSheet.getLastRow(), 3)
      .getValues();
  }

  for (let i = 0; i < accumulatedData.length; i++) {
    // 文字列に変換
    let tempDate = new Date(accumulatedData[i][1]);
    accumulatedData[i][1] = Utilities.formatDate(
      tempDate,
      "GMT+9",
      "HH:mm:ss"
    ).toString();
  }

  for (let i = 0; i < busDataList.length; i++) {
    // '生麦生米生卵'.includes('卵') // true
    let doSaveRecord = true;
    for (let j = 0; j < accumulatedData.length; j++) {
      if (
        accumulatedData[j][0].includes(busDataList[i][0]) &&
        accumulatedData[j][1].includes(busDataList[i][1])
      ) {
        // 運行路線情報と始発時刻を比較し，既に記録されているか判定
        // 記録されている場合は，記録及び通知は行わない．
        doSaveRecord = false;
        break;
      }
    }

    if (doSaveRecord) {
      // 記録及び通知の実施

      // 特急車の場合はfalseにする
      let isLocalBus = true;
      for (let k = 0; k < expressBusData.length; k++) {
        if (busDataList[i][2].includes(expressBusData[k])) {
          isLocalBus = false;
          break;
        }
      }

      let messtr =
        busDataList[i][1] +
        "発 " +
        getRouteShortName(busDataList[i][0]) +
        " " +
        busDataList[i][2] +
        "が出発しました。";

      if (isLocalBus) {
        messtr += "\n:warning:普通バスが検出されました。";
      }

      notifyToDiscord(messtr);

      busDataList[i][1] = getDateString("yyyy/MM/dd ") + busDataList[i][1];
      writeSheet
        .getRange(writeSheet.getLastRow() + 1, 1, 1, 3)
        .setValues([busDataList[i]]);
    }
  }
}

function main() {
  // 時刻取得
  let result = getDateString("mm");
  let mm = parseInt(result, 10);

  // TODO:負荷軽減のため，バス稼働時間外は通信を防止したい

  let contents = "";
  let testFlag = false;

  if (testFlag) {
    // テストコンテンツ読み込み
    contents = DriveApp.getFileById("")
      .getBlob()
      .getDataAsString("UTF-8");
  } else {
    // コンテンツ読み込み
    contents = getGtfsData();
  }

  // 運行情報をリストに変換
  let contentsList = contents.split(/!tripUpdate_/);
  if (contentsList.length <= 1) {
    Logger.log("処理対象データなし");
    return;
  }

  let busDataList = [];
  for (let i = 1; i < contentsList.length; i++) {
    // 渋川特急運行情報のみをroute_id, departure_time, バス号車番号の体裁で読み出し

    if (!/25003_\d+_1/.test(contentsList[i])) {
      // 渋川特急でない場合はスキップ
      continue;
    }

    let busData = [];
    busData.push(contentsList[i].match(/25003+_\d+_\d+/));
    busData.push(contentsList[i].match(/\d{2,2}:\d{2,2}:\d{2,2}/));
    busData.push(contentsList[i].match(/F\d{4,4}/));
    busDataList.push(busData);
  }

  if (busDataList.length > 0) {
    notify(busDataList);
  }

  // if (mm % 10 >= 5)
  // {
  // 10分おきになるように間引き
  if (testFlag) {
    Logger.log("テストデータは出力しません");
  } else {
    saveTextFile(contents);
  }
  // }
}
