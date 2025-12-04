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

    // 呼叫 CWA API
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-C0032-001`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: city,
        },
      }
    );

    const records = response.data.records;

    if (!records || !records.location || records.location.length === 0) {
      return res.status(404).json({
        error: "查無資料",
        message: `無法取得 ${city} 天氣資料`,
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
      // API 回應錯誤
      return res.status(error.response.status).json({
        error: "CWA API 錯誤",
        message: error.response.data?.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    // 其他錯誤
    return res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// 依經緯度反查所在縣市（使用 OpenStreetMap Nominatim）
const reverseGeocode = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: "參數錯誤",
        message: "請提供 lat 和 lng，例如 /api/reverse-geocode?lat=...&lng=...",
      });
    }

    const response = await axios.get(
      "https://nominatim.openstreetmap.org/reverse",
      {
        params: {
          format: "jsonv2",
          lat,
          lon: lng,
          "accept-language": "zh-TW", // 要中文地址
        },
        headers: {
          // 建議換成你自己的 email
          "User-Agent": "CWA-Weather-Demo (example@example.com)",
        },
      }
    );

    const data = response.data;
    const address = data.address || {};

    // 優先順序：city > county > state
    const cityName =
      address.city || address.county || address.state || "";

    if (!cityName) {
      return res.status(404).json({
        success: false,
        error: "查無城市名稱",
        message: "無法從座標取得城市資訊",
        raw: data,
      });
    }

    // 如果有需要，你可以在這裡做進一步格式調整，例如只保留「高雄市」、「台北市」這種
    // 目前先直接回傳 cityName
    return res.json({
      success: true,
      city: cityName,
      raw: data, // 想除錯時可以看，前端用不到可以不理它
    });
  } catch (error) {
    console.error("Reverse geocode 失敗:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        error: "ReverseGeocode API 錯誤",
        message: error.response.data?.error || "無法取得縣市資訊",
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
      // 範例：/api/weather?city=高雄市
      weather: "/api/weather?city=高雄市",
      health: "/api/health",
      kaohsiungShortcut: "/api/weather/kaohsiung",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 通用：依城市取得天氣，例如 /api/weather?city=高雄市
app.get("/api/weather", getWeatherByCity);

// 範例：固定高雄市的捷徑路徑（可用可不用）
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
  console.log(`🚀 伺服器運行已運作，PORT: ${PORT}`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});
