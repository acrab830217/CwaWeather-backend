// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

// ✅ 先固定用 3000，避免跟環境變數打架
const PORT = 3000;

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "https://acrab830217.github.io",  // 你的 GitHub Pages 網址
    ],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 依城市名稱取得今明 36 小時天氣預報
 * 使用 CWA「一般天氣預報-今明 36 小時天氣預報」資料集
 * 範例：/api/weather?city=桃園市
 */
const getWeatherByCity = async (req, res) => {
  try {
    if (!CWA_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    const city = req.query.city;

    if (!city) {
      return res.status(400).json({
        success: false,
        error: "參數錯誤",
        message: "請在查詢字串提供 city，例如 ?city=桃園市",
      });
    }

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
        success: false,
        error: "查無資料",
        message: `無法取得 ${city} 天氣資料`,
      });
    }

    const locationData = records.location[0];

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
      return res.status(error.response.status).json({
        success: false,
        error: "CWA API 錯誤",
        message: error.response.data?.message || "無法取得天氣資料",
        details: error.response.data,
      });
    }

    return res.status(500).json({
      success: false,
      error: "伺服器錯誤",
      message: "無法取得天氣資料，請稍後再試",
    });
  }
};

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "歡迎使用 CWA 天氣預報 API",
    endpoints: {
      weather: "/api/weather?city=桃園市",
      health: "/api/health",
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 通用：依城市取得天氣
app.get("/api/weather", getWeatherByCity);

// 404 handler（放在最後）
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "找不到此路徑",
  });
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`🚀 伺服器運行已運作，PORT: ${PORT}`);
  console.log(`📍 環境: ${process.env.NODE_ENV || "development"}`);
});
