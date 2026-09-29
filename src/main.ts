import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./studio-vue.css";
createApp(App).use(createPinia()).mount("#root");
