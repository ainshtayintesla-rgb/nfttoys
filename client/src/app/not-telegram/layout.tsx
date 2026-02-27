import '../globals.css';

export const metadata = {
    title: 'NFT Toys - Telegram Required',
    description: 'Please open this app through Telegram',
};

export default function NotTelegramLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
