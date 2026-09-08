import { app } from 'electron';
app.setPath('userData', process.argv[2]);
const acquired = app.requestSingleInstanceLock({ pasteTarget: process.argv[3] });
console.log(acquired ? 'unexpected-primary' : 'secondary-delivered');
app.quit();
