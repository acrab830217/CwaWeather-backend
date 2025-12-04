require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 小工具：把 Nominatim 回傳的城市名稱修正成 CWA 可用格式
 * - 優先用「county」（例如 新北市），避免拿到「板橋區」
 * - 把「台北市/台中市/台南市/台東縣」改成 CWA 使用的「臺」
 */
function normalizeTaiwanCityName(rawName) {
  if (!rawName) return "";

  let name = rawName.trim();

  // 常見的「台」→「臺」對應
  const mapping = {
    "台北市": "臺北市",
    "台中市": "臺中市",
    "台南市": "臺南市",
    "台東縣": "臺東縣",
  };

  if (mapping[name]) {
    return mapping[name];
  }

  return name;
}

/**
 * 依城市名稱取得今明 36 小時天氣預報
 * 使用 CWA「一般天氣預報-今明 36 小時天氣預報」資料集
 * 範例：/api/weather?city=高雄市
 */
const getWeatherByCity = async (req, res) => {
  try {
    // 檢查是否有設定 API Key
    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 從 querystring 取得城市名稱，例如 ?city=高雄市
    const city = req.query.city;

    if (!city) {
      return res.status(400).json({
        error: "參數錯誤",
        message: "請在查詢字串提供 city，例如 ?city=高雄市",
      });
    }

    console.log("[getWeatherByCity] 查詢城市:", city);

    // 呼叫 CWA API
    const response = await axios.get(
      CWA_API_BASE_URL + "/v1/rest/datastore/F-C0032-001",
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: city,
        },
      }
    );

    const records = response.data && response.data.records;

    if (
      !records ||
      !records.location ||
      !Array.isArray(records.location) ||
      records.location.length === 0
    ) {
      console.warn("[getWeatherByCity] CWA 無對應資料，city =", city);
      return res.status(404).json({
        error: "查無資料",
        message: "無法取得「" + city + "」的天氣資料（可能是城市名稱不符合 CWA 格式）",
      });
    }

    const locationData = records.location[0];

    // 整理天氣資料
    const weatherData = {
      city: locationData.locationName,
      updateTime: records.datasetDescription,
      forecasts: [],
    };

    const weatherElements = locationData.weatherElement;
    const timeCount = weatherElements[0].time.length;

    for (let i = 0; i < timeCount; i++) {
      const forecast = {
        startTime: weatherElements[0].time[i].startTime,
        endTime: weatherElements[0].time[i].endTime,
        weather: "",
        rain: "",
        minTemp: "",
        maxTemp: "",
        comfort: "",
        windSpeed: "",
      };

      weatherElements.forEach((element) => {
        const value = element.time[i].parameter;
        switch (element.elementName) {
          case "Wx":
            forecast.weather = value.parameterName;
            break;
          case "PoP":
            forecast.rain = value.parameterName + "%";
            break;
          case "MinT":
            forecast.minTemp = value.parameterName + "°C";
            break;
          case "MaxT":
            forecast.maxTemp = value.parameterName + "°C";
            break;
          case "CI":
            forecast.comfort = value.parameterName;
            break;
          case "WS":
            forecast.windSpeed = value.parameterName;
            break;
        }
      });

      weatherData.forecasts.push(forecast);
    }

    return res.json({
      success: true,
      data: weatherData,
    });
  } catch (error) {
    console.error("取得天氣資料失敗:", error.message);

    if (error.response) {
      const respData = error.response.data || {};
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: respData.message || "無法取得天氣資料",
        details: respData,
      });
    }

    return res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// 依經緯度反查所在縣市（使用 OpenStreetMap Nominatim）
const reverseGeocode = async (req, res) => {
  try {
    const lat = req.query.lat;
    const lng = req.query.lng;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: "參數錯誤",
        message:
          "請提供 lat 和 lng，例如 /api/reverse-geocode?lat=25.0478&lng=121.5319",
      });
    }

    console.log("[reverseGeocode] 收到座標:", lat, lng);

    // 這裡先不用自訂 headers，改用預設 User-Agent，避免被 Nominatim 擋掉
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          format: "jsonv2",
          lat: lat,
          lon: lng,
          "accept-language": "zh-TW",
          addressdetails: 1,
        },
      }
    );

    const data = response.data || {};
    const address = data.address || {};

    console.log("[reverseGeocode] Nominatim 回傳地址:", address);

    // 優先用 county（通常是「新北市」、「高雄市」），再 fallback
    let rawCityName =
      address.county ||
      address.city ||
      address.town ||
      address.city_district ||
      address.state ||
      "";

    if (!rawCityName) {
      console.warn("[reverseGeocode] 無法從 address 解析城市名稱");
      return res.status(404).json({
        success: false,
        error: "查無城市名稱",
        message: "無法從座標取得城市資訊",
        raw: data,
      });
    }

    // 簡單做個「台→臺」轉換，方便丟給 CWA 用
    const mapping = {
      "台北市": "臺北市",
      "台中市": "臺中市",
      "台南市": "臺南市",
      "台東縣": "臺東縣",
    };
    const normalizedCity = mapping[rawCityName] || rawCityName;

    console.log(
      "[reverseGeocode] rawCityName =",
      rawCityName,
      "→ normalizedCity =",
      normalizedCity
    );

    return res.json({
      success: true,
      city: normalizedCity,
      raw: data,
    });
  } catch (error) {
    console.error("[reverseGeocode] 發生錯誤:", error.message);

    if (error.response) {
      console.error(
        "[reverseGeocode] HTTP 狀態碼:",
        error.response.status
      );
      console.error("[reverseGeocode] 回應內容:", error.response.data);

      const respData = error.response.data;
      let msg = "無法取得縣市資訊";

      if (typeof respData === "string") {
        msg = respData;
      } else if (respData && respData.error) {
        msg = respData.error;
      }

      return res.status(error.response.status).json({
        success: false,
        error: "ReverseGeocode API 錯誤",
        message: msg,
      });
    }

    return res.status(500).json({
      success: false,
      error: "伺服器錯誤",
      message: "無法取得縣市資訊，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      weather: "/api/weather?city=高雄市",
      health: "/api/health",
      kaohsiungShortcut: "/api/weather/kaohsiung",
      reverseGeocode: "/api/reverse-geocode?lat=25.0478&lng=121.5319",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 依經緯度查縣市
app.get("/api/reverse-geocode", reverseGeocode);

// 通用：依城市取得天氣
app.get("/api/weather", getWeatherByCity);

// 固定高雄市捷徑
app.get("/api/weather/kaohsiung", (req, res) => {
  req.query.city = "高雄市";
  getWeatherByCity(req, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "伺服器錯誤",
    message: err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "找不到此路徑",
  });
});

app.listen(PORT, () => {
  console.log("🚀 伺服器運行已運作，PORT:", PORT);
  console.log("📍 環境:", process.env.NODE_ENV || "development");
});
